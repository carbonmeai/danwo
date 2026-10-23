import type { Context } from "../../http.ts"
import { type Caller, repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubCommentRecord, GithubRepoRecord } from "../entities.ts"
import {
  bodyOf,
  GithubApiError,
  missingField,
  nextGhId,
  notFound,
  paged,
  stringField,
} from "../helpers.ts"
import { commentObject } from "../issue-format.ts"
import { requireIssue } from "../issues.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "issues", write: false } as const
const WRITE = { permission: "issues", write: true } as const

/** A comment of the repository by id, with its issue, or a 404. */
function requireComment(gh: GithubStore, repo: GithubRepoRecord, id: number) {
  const comment = gh.comments.findOneBy("ghId", id)

  if (!comment || comment.repoId !== repo.id) throw notFound()

  return { comment, issue: requireIssue(gh, repo, comment.issueNumber) }
}

/** The GitHub App a caller acts through: an installation's, or a GitHub App user token's. */
function appThrough(caller: Caller): number | null {
  if (caller.kind === "installation") return caller.installation.appId

  return caller.kind === "user" && caller.app ? caller.app.ghId : null
}

/** A comment's text from a request body: `body` is required and may not be empty. */
async function commentText(c: Context): Promise<string> {
  const text = stringField(await bodyOf(c), "body")

  if (text === undefined || text === "") throw missingField("IssueComment", "body")

  return text
}

async function createComment(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, caller, actor } = repoAccess(c, context, WRITE)
  const issue = requireIssue(gh, repo, Number(c.req.param("number")))

  if (issue.locked)
    throw new GithubApiError(403, "Unable to create comment because issue is locked.")

  const comment = gh.comments.insert({
    ghId: nextGhId(context.store),
    repoId: repo.id,
    issueNumber: issue.number,
    body: await commentText(c),
    author: actor,
    appId: appThrough(caller),
  })
  const counted = gh.issues.update(issue.id, { comments: issue.comments + 1 }) ?? issue

  context.events.comment("created", repo, { issue: counted, comment }, actor)

  return c.json(commentObject(gh, repo, comment, true), 201)
}

async function updateComment(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor } = repoAccess(c, context, WRITE)
  const found = requireComment(gh, repo, Number(c.req.param("id")))
  const comment =
    gh.comments.update(found.comment.id, { body: await commentText(c) }) ?? found.comment

  context.events.comment("edited", repo, { issue: found.issue, comment }, actor)

  return c.json(commentObject(gh, repo, comment))
}

function deleteComment(c: Context, context: GithubRouteContext): Response {
  const { gh, repo, actor } = repoAccess(c, context, WRITE)
  const found = requireComment(gh, repo, Number(c.req.param("id")))
  const issue =
    gh.issues.update(found.issue.id, { comments: Math.max(0, found.issue.comments - 1) }) ??
    found.issue

  gh.comments.delete(found.comment.id)
  context.events.comment("deleted", repo, { issue, comment: found.comment }, actor)

  return c.body(null, 204)
}

function listComments(
  c: Context,
  gh: GithubStore,
  repo: GithubRepoRecord,
  comments: GithubCommentRecord[],
) {
  return c.json(paged(c, comments).map((comment) => commentObject(gh, repo, comment)))
}

/** Issue and pull request comments. */
export function commentRoutes(context: GithubRouteContext): void {
  const { app } = context
  const base = "/repos/:owner/:repo/issues"

  app.get(`${base}/comments`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return listComments(
      c,
      gh,
      repo,
      gh.comments.all().filter((comment) => comment.repoId === repo.id),
    )
  })
  app.get(`${base}/:number/comments`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const issue = requireIssue(gh, repo, Number(c.req.param("number")))
    const comments = gh.comments
      .all()
      .filter((comment) => comment.repoId === repo.id && comment.issueNumber === issue.number)

    return listComments(c, gh, repo, comments)
  })
  app.post(`${base}/:number/comments`, (c) => createComment(c, context))
  app.get(`${base}/comments/:id`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(
      commentObject(gh, repo, requireComment(gh, repo, Number(c.req.param("id"))).comment),
    )
  })
  app.patch(`${base}/comments/:id`, (c) => updateComment(c, context))
  app.delete(`${base}/comments/:id`, (c) => deleteComment(c, context))
}
