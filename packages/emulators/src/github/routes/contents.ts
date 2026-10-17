import type { Context } from "../../http.ts"
import { type Caller, repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubCommitRecord, GithubRepoRecord, GitPerson } from "../entities.ts"
import { contentFile, directoryEntry, fileCommit } from "../git-format.ts"
import { branchHead, commitTo, resolveCommit } from "../git.ts"
import {
  bodyOf,
  GithubApiError,
  missingField,
  notFound,
  stringField,
  tailRoute,
} from "../helpers.ts"
import { announcePush } from "../pushes.ts"
import type { GithubStore } from "../store.ts"

type Where = { readonly owner: string; readonly repo: string; readonly tail: string }

/** The entries directly inside `dir` of a tree: files, and directories found under deeper paths. */
function listDirectory(tree: Record<string, string>, dir: string) {
  const prefix = dir === "" ? "" : `${dir}/`
  const entries = new Map<string, { path: string; sha: string; dir: boolean }>()

  for (const [path, sha] of Object.entries(tree)) {
    if (!path.startsWith(prefix)) continue

    const [first = "", ...rest] = path.slice(prefix.length).split("/")
    const child = `${prefix}${first}`

    entries.set(
      child,
      rest.length > 0 ? { path: child, sha: child, dir: true } : { path, sha, dir: false },
    )
  }

  return [...entries.values()].toSorted((a, b) => a.path.localeCompare(b.path))
}

/** The commit `?ref` names, the default branch's head without one. */
function commitAt(
  c: Context,
  gh: GithubStore,
  repo: GithubRepoRecord,
): { commit: GithubCommitRecord; ref: string } {
  const ref = c.req.query("ref") ?? repo.defaultBranch
  const commit = resolveCommit(gh, repo.id, ref)

  if (!commit) throw new GithubApiError(404, `No commit found for the ref ${ref}`)

  return { commit, ref }
}

function getContents(c: Context, context: GithubRouteContext, where: Where): Response {
  const { gh, repo } = repoAccess(c, context, { permission: "contents", write: false }, where)

  if (!branchHead(gh, repo.id, repo.defaultBranch) && c.req.query("ref") === undefined)
    throw new GithubApiError(404, "This repository is empty.")

  const { commit, ref } = commitAt(c, gh, repo)
  const file = commit.tree[where.tail]

  if (file) return c.json(contentFile(gh, repo, where.tail, ref, file))

  const entries = listDirectory(commit.tree, where.tail)

  if (entries.length === 0) throw notFound()

  return c.json(entries.map((entry) => directoryEntry(gh, repo, entry, ref)))
}

/** Who a commit made through the API is by: `author` or `committer` from the body, or the caller. */
function authorOf(body: Record<string, unknown>, actor: string, now: string): GitPerson {
  const given = [body.author, body.committer].find(
    (value): value is { name: unknown; email: unknown } =>
      typeof value === "object" && value !== null && "name" in value && "email" in value,
  )

  if (given && typeof given.name === "string" && typeof given.email === "string")
    return { name: given.name, email: given.email, date: now }

  return { name: actor, email: `${actor}@users.noreply.github.com`, date: now }
}

/** The branch a write goes to; an empty repository starts its default branch. */
function targetBranch(
  gh: GithubStore,
  repo: GithubRepoRecord,
  body: Record<string, unknown>,
): string {
  const branch = stringField(body, "branch") ?? repo.defaultBranch
  const empty = !branchHead(gh, repo.id, repo.defaultBranch)

  if (!empty && !branchHead(gh, repo.id, branch))
    throw new GithubApiError(404, `Branch ${branch} not found`)

  return branch
}

/** The checks on `sha` before changing an existing file: it must be given and current. */
function checkSha(path: string, current: string | undefined, given: string | undefined): void {
  if (current === undefined) return
  if (given === undefined)
    throw new GithubApiError(422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
  if (given !== current) throw new GithubApiError(409, `${path} does not match ${given}`)
}

/** Commits one change to one path and answers as GitHub's contents API does. */
function commitChange(
  c: Context,
  context: GithubRouteContext,
  access: { gh: GithubStore; repo: GithubRepoRecord; actor: string; caller: Caller },
  change: { path: string; branch: string; content: Buffer | null; body: Record<string, unknown> },
  status: number,
): Response {
  const { gh, repo, actor } = access
  const push = commitTo(gh, repo, change.branch, {
    files: { [change.path]: change.content },
    message: stringField(change.body, "message") ?? "",
    author: authorOf(change.body, actor, context.clock().toISOString()),
  })
  const commit = push.commits[0]

  if (!commit) throw notFound()
  announcePush(context, repo, push, actor)

  return c.json(
    fileCommit(gh, repo, commit, change.content ? { path: change.path, ref: change.branch } : null),
    status,
  )
}

async function putContents(
  c: Context,
  context: GithubRouteContext,
  where: Where,
): Promise<Response> {
  const access = repoAccess(c, context, { permission: "contents", write: true }, where)
  const body = await bodyOf(c)
  const content = stringField(body, "content")

  if (!stringField(body, "message")) throw missingField("Contents", "message")
  if (content === undefined) throw missingField("Contents", "content")

  const branch = targetBranch(access.gh, access.repo, body)
  const current = branchHead(access.gh, access.repo.id, branch)?.tree[where.tail]

  checkSha(where.tail, current, stringField(body, "sha"))

  return commitChange(
    c,
    context,
    access,
    { path: where.tail, branch, content: Buffer.from(content, "base64"), body },
    current ? 200 : 201,
  )
}

async function deleteContents(
  c: Context,
  context: GithubRouteContext,
  where: Where,
): Promise<Response> {
  const access = repoAccess(c, context, { permission: "contents", write: true }, where)
  const body = await bodyOf(c)
  const branch = targetBranch(access.gh, access.repo, body)
  const current = branchHead(access.gh, access.repo.id, branch)?.tree[where.tail]

  if (!stringField(body, "message")) throw missingField("Contents", "message")
  if (current === undefined) throw notFound()
  checkSha(where.tail, current, stringField(body, "sha") ?? "")

  return commitChange(c, context, access, { path: where.tail, branch, content: null, body }, 200)
}

/** Reading, creating, updating and deleting files through the contents API. */
export function contentRoutes(context: GithubRouteContext): void {
  const { app } = context

  tailRoute(app, "GET", "contents", (c, where) => getContents(c, context, where))
  tailRoute(app, "PUT", "contents", (c, where) => putContents(c, context, where))
  tailRoute(app, "DELETE", "contents", (c, where) => deleteContents(c, context, where))
}
