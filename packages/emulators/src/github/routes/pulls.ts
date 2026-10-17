import type { Context } from "../../http.ts"
import { type Need, repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type {
  GithubIssueRecord,
  GithubPullRecord,
  GithubRepoRecord,
  GithubReviewRecord,
  GitPerson,
} from "../entities.ts"
import { commitObject } from "../git-format.ts"
import {
  branchHead,
  changedTree,
  type FileChange,
  blobBytes,
  mergeBase,
  setRef,
  writeCommit,
} from "../git.ts"
import {
  bodyOf,
  GithubApiError,
  given,
  invalid,
  nextGhId,
  notFound,
  paged,
  stringField,
} from "../helpers.ts"
import { diffEntryObject, pullDiff, pullObject, reviewObject } from "../issue-format.ts"
import { openIssue, requireIssue, stateChange } from "../issues.ts"
import { announcePush } from "../pushes.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "pull_requests", write: false } as const
const WRITE = { permission: "pull_requests", write: true } as const

/** Pull request `number`, with its issue, or a 404 (also for an issue that is not a pull request). */
function requirePull(gh: GithubStore, repo: GithubRepoRecord, number: number) {
  const issue = requireIssue(gh, repo, number)
  const pull = gh.pulls.findBy("repoId", repo.id).find((candidate) => candidate.number === number)

  if (!pull) throw notFound()

  return { pull, issue }
}

/** `head` may be `branch` or `owner:branch`; forks are not emulated, so the owner is dropped. */
const branchName = (head: string) => head.split(":").at(-1) ?? head

const pullInvalid = (field: string, message?: string) =>
  invalid([
    {
      resource: "PullRequest",
      field,
      code: message ? "custom" : "invalid",
      ...(message && { message }),
    },
  ])

/** The head and base a new pull request names, checked as GitHub checks them. */
function checkEnds(gh: GithubStore, repo: GithubRepoRecord, head: string, base: string) {
  const baseHead = branchHead(gh, repo.id, base)

  if (!branchHead(gh, repo.id, head)) throw pullInvalid("head")
  if (!baseHead) throw pullInvalid("base")
  if (head === base) throw invalid([], `No commits between ${base} and ${head}`)

  const open = gh.pulls
    .findBy("repoId", repo.id)
    .some(
      (p) =>
        p.head === head &&
        p.base === base &&
        !p.merged &&
        requireIssue(gh, repo, p.number).state === "open",
    )

  if (open) throw pullInvalid("", `A pull request already exists for ${repo.owner}:${head}.`)

  return baseHead
}

async function createPull(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor } = repoAccess(c, context, WRITE)
  const body = await bodyOf(c)
  const head = branchName(stringField(body, "head") ?? "")
  const base = stringField(body, "base") ?? repo.defaultBranch
  const baseHead = checkEnds(gh, repo, head, base)
  const issue = openIssue(gh, context.store, repo, {
    title: stringField(body, "title") ?? "",
    body: stringField(body, "body") ?? null,
    author: actor,
    isPull: true,
  })
  const pull = gh.pulls.insert({
    ghId: nextGhId(context.store),
    repoId: repo.id,
    number: issue.number,
    head,
    base,
    baseSha: baseHead.sha,
    draft: body.draft === true,
    merged: false,
    mergedAt: null,
    mergedBy: null,
    mergeSha: null,
  })

  context.events.pull("opened", repo, { pull, issue }, actor)

  return c.json(pullObject(gh, repo, pull, issue), 201)
}

/** The pull request a write to `…/pulls/{number}/…` names, with the request's body. */
async function writablePull(c: Context, context: GithubRouteContext, need: Need = WRITE) {
  const access = repoAccess(c, context, need)
  const found = requirePull(access.gh, access.repo, Number(c.req.param("number")))

  return { ...access, found, body: await bodyOf(c) }
}

/** The issue fields a pull request update changes: title, body and, unless merged, state. */
function pullIssueChanges(
  found: ReturnType<typeof requirePull>,
  body: Record<string, unknown>,
  now: string,
): Partial<GithubIssueRecord> {
  const state = stringField(body, "state")
  const settable = (state === "open" || state === "closed") && !found.pull.merged

  return {
    ...given("title", stringField(body, "title")),
    ...("body" in body && { body: stringField(body, "body") ?? null }),
    ...(settable && stateChange(found.issue, state, null, now)),
  }
}

/** Points a pull request at a new base branch, if one was asked for. */
function retarget(gh: GithubStore, repo: GithubRepoRecord, pull: GithubPullRecord, base?: string) {
  if (base === undefined) return pull

  const baseHead = branchHead(gh, repo.id, base)

  if (!baseHead) throw pullInvalid("base")

  return gh.pulls.update(pull.id, { base, baseSha: baseHead.sha }) ?? pull
}

async function updatePull(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor, found, body } = await writablePull(c, context)
  const pull = retarget(gh, repo, found.pull, stringField(body, "base"))
  const now = context.clock().toISOString()
  const issue = gh.issues.update(found.issue.id, pullIssueChanges(found, body, now)) ?? found.issue

  announceUpdate(context, repo, { before: found.issue, issue, pull }, actor)

  return c.json(pullObject(gh, repo, pull, issue))
}

/** The `pull_request` events an update causes. */
function announceUpdate(
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  change: {
    readonly before: GithubIssueRecord
    readonly issue: GithubIssueRecord
    readonly pull: GithubPullRecord
  },
  actor: string,
): void {
  const { before, issue, pull } = change

  if (issue.title !== before.title || issue.body !== before.body)
    context.events.pull("edited", repo, { pull, issue }, actor)
  if (issue.state !== before.state)
    context.events.pull(
      issue.state === "closed" ? "closed" : "reopened",
      repo,
      { pull, issue },
      actor,
    )
}

/**
 * The tree a merge produces: the head's tree when the base has not moved since the head left it,
 * else the base's tree with the head's changes since their common commit laid on top.
 */
function mergedTree(gh: GithubStore, repo: GithubRepoRecord, pull: GithubPullRecord) {
  const head = branchHead(gh, repo.id, pull.head)
  const base = branchHead(gh, repo.id, pull.base)

  if (!head || !base) throw notFound()

  const common = mergeBase(gh, head.sha, base.sha)

  if (common?.sha === base.sha) return { head, base, tree: head.tree }

  return {
    head,
    base,
    tree: changedTree(gh, base.tree, headChanges(gh, common?.tree ?? {}, head.tree)),
  }
}

/** What the head changed since the common commit, as file changes to lay onto the base. */
function headChanges(
  gh: GithubStore,
  common: Record<string, string>,
  head: Record<string, string>,
): FileChange {
  const changes: Record<string, Buffer | null> = {}

  for (const path of new Set([...Object.keys(common), ...Object.keys(head)])) {
    const sha = head[path]

    if (common[path] !== sha) changes[path] = sha === undefined ? null : blobBytes(gh, sha)
  }

  return changes
}

/** Why a pull request cannot be merged, if it cannot. */
function mergeRefusal(
  found: ReturnType<typeof requirePull>,
  head: string | undefined,
  asked: string | undefined,
) {
  if (found.pull.merged || found.issue.state !== "open")
    return new GithubApiError(405, "Pull Request is not mergeable")
  if (asked !== undefined && asked !== head)
    return new GithubApiError(409, "Head branch was modified. Review and try the merge again.")

  return undefined
}

async function mergePull(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor, found, body } = await writablePull(c, context, {
    permission: "contents",
    write: true,
  })
  const refusal = mergeRefusal(
    found,
    branchHead(gh, repo.id, found.pull.head)?.sha,
    stringField(body, "sha"),
  )

  if (refusal) throw refusal

  const { head, base, tree } = mergedTree(gh, repo, found.pull)
  const method = stringField(body, "merge_method") ?? "merge"
  const now = context.clock().toISOString()
  const author: GitPerson = { name: actor, email: `${actor}@users.noreply.github.com`, date: now }
  const title =
    stringField(body, "commit_title") ??
    `Merge pull request #${found.pull.number} from ${repo.owner}/${found.pull.head}`
  const commit = writeCommit(gh, repo.id, {
    tree,
    parents: method === "merge" ? [base.sha, head.sha] : [base.sha],
    message: [title, stringField(body, "commit_message") ?? found.issue.title].join("\n\n"),
    author,
  })

  setRef(gh, repo.id, `refs/heads/${found.pull.base}`, commit.sha)

  const pull =
    gh.pulls.update(found.pull.id, {
      merged: true,
      mergedAt: now,
      mergedBy: actor,
      mergeSha: commit.sha,
    }) ?? found.pull
  const issue =
    gh.issues.update(found.issue.id, stateChange(found.issue, "closed", "completed", now)) ??
    found.issue

  announcePush(
    context,
    repo,
    { branch: found.pull.base, before: base.sha, commits: [commit] },
    actor,
  )
  context.events.pull("closed", repo, { pull, issue }, actor)

  return c.json({ sha: commit.sha, merged: true, message: "Pull Request successfully merged" })
}

/** The review state each `event` leaves; no event leaves a pending review. */
const REVIEW_STATES = {
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  COMMENT: "COMMENTED",
} as const

/** What a review needs: approving one's own pull request is refused; only approval may be empty. */
function checkReview(state: GithubReviewRecord["state"], text: string, own: boolean): void {
  if (state === "APPROVED" && own)
    throw invalid([], "Unprocessable Entity: Can not approve your own pull request")
  if (state === "COMMENTED" && text === "")
    throw invalid([], "Unprocessable Entity: Review Can not comment without a body")
  if (state === "CHANGES_REQUESTED" && text === "")
    throw invalid([], "Unprocessable Entity: Review Can not request changes without a body")
}

async function createReview(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor, found, body } = await writablePull(c, context)
  const event = stringField(body, "event") ?? ""
  const text = stringField(body, "body") ?? ""
  const state = Object.entries(REVIEW_STATES).find(([name]) => name === event)?.[1] ?? "PENDING"

  checkReview(state, text, found.issue.author === actor)

  const review = gh.reviews.insert({
    ghId: nextGhId(context.store),
    repoId: repo.id,
    pullNumber: found.pull.number,
    author: actor,
    body: text,
    state,
    commitSha: branchHead(gh, repo.id, found.pull.head)?.sha ?? found.pull.baseSha,
  })

  if (state !== "PENDING") context.events.review(repo, review, found)

  return c.json(reviewObject(gh, repo, review))
}

/** The pull request a `…/pulls/{number}/…` request names, for reading. */
function readPull(c: Context, context: GithubRouteContext) {
  const { gh, repo } = repoAccess(c, context, READ)

  return { gh, repo, found: requirePull(gh, repo, Number(c.req.param("number"))) }
}

/** Pull requests: list, create, read, update and merge; their files, commits and reviews. */
export function pullRoutes(context: GithubRouteContext): void {
  const { app } = context
  const path = "/repos/:owner/:repo/pulls"
  const read = (c: Context) => readPull(c, context)

  app.get(path, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const state = c.req.query("state") ?? "open"
    const head = c.req.query("head")
    const base = c.req.query("base")
    const pulls = gh.pulls.findBy("repoId", repo.id).flatMap((pull) => {
      const issue = requireIssue(gh, repo, pull.number)
      const wanted =
        (state === "all" || issue.state === state) &&
        (head === undefined || pull.head === branchName(head)) &&
        (base === undefined || pull.base === base)

      return wanted ? [pullObject(gh, repo, pull, issue)] : []
    })

    return c.json(paged(c, pulls.toReversed()))
  })
  app.post(path, (c) => createPull(c, context))
  app.get(`${path}/:number`, (c) => {
    const { gh, repo, found } = read(c)

    return c.json(pullObject(gh, repo, found.pull, found.issue))
  })
  app.patch(`${path}/:number`, (c) => updatePull(c, context))
  app.put(`${path}/:number/merge`, (c) => mergePull(c, context))
  app.get(`${path}/:number/merge`, (c) => {
    const { found } = read(c)

    return found.pull.merged ? c.body(null, 204) : c.json({ message: "Not Found" }, 404)
  })
  app.get(`${path}/:number/files`, (c) => {
    const { gh, repo, found } = read(c)
    const { files } = pullDiff(gh, repo, found.pull)

    return c.json(paged(c, files).map((file) => diffEntryObject(repo, found.pull.head, file)))
  })
  app.get(`${path}/:number/commits`, (c) => {
    const { gh, repo, found } = read(c)

    return c.json(
      paged(c, pullDiff(gh, repo, found.pull).commits.toReversed()).map((commit) =>
        commitObject(gh, repo, commit),
      ),
    )
  })
  app.get(`${path}/:number/reviews`, (c) => {
    const { gh, repo, found } = read(c)
    const reviews = gh.reviews
      .findBy("repoId", repo.id)
      .filter((r) => r.pullNumber === found.pull.number)

    return c.json(paged(c, reviews).map((review) => reviewObject(gh, repo, review)))
  })
  app.post(`${path}/:number/reviews`, (c) => createReview(c, context))
}
