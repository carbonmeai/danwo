import type { Context } from "../../http.ts"
import { repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubCommitRecord } from "../entities.ts"
import { branchObject, commitObject, refObject, shortBranch } from "../git-format.ts"
import { branchesOf, branchHead, diffTrees, history, refOf, resolveCommit, setRef } from "../git.ts"
import {
  bodyOf,
  GithubApiError,
  invalid,
  notFound,
  paged,
  stringField,
  tailRoute,
} from "../helpers.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "contents", write: false } as const
const WRITE = { permission: "contents", write: true } as const

/** Whether a commit changed `path` (a file, or anything under a directory) from its first parent. */
function touches(gh: GithubStore, commit: GithubCommitRecord, path: string): boolean {
  const parent = commit.parents[0] ? gh.commits.findOneBy("sha", commit.parents[0]) : undefined

  return diffTrees(gh, parent?.tree ?? {}, commit.tree).some(
    (file) => file.filename === path || file.filename.startsWith(`${path}/`),
  )
}

function listCommits(c: Context, context: GithubRouteContext): Response {
  const { gh, repo } = repoAccess(c, context, READ)
  const start = resolveCommit(gh, repo.id, c.req.query("sha") ?? repo.defaultBranch)

  if (!start) throw new GithubApiError(409, "Git Repository is empty.")

  const path = c.req.query("path")
  const commits = history(gh, start.sha).filter(
    (commit) => path === undefined || touches(gh, commit, path),
  )

  return c.json(paged(c, commits).map((commit) => commitObject(gh, repo, commit)))
}

/** `POST /git/refs`: a new ref at an existing commit. */
async function createRef(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo } = repoAccess(c, context, WRITE)
  const body = await bodyOf(c)
  const ref = stringField(body, "ref") ?? ""
  const sha = stringField(body, "sha") ?? ""

  if (!/^refs\/[^/]+\/.+/.test(ref))
    throw invalid([], "Reference name must start with 'refs/' and have at least two slashes.")
  if (refOf(gh, repo.id, ref)) throw invalid([], "Reference already exists")
  if (!gh.commits.findOneBy("sha", sha)) throw invalid([], "Object does not exist")
  setRef(gh, repo.id, ref, sha)

  return c.json(refObject(repo, { ref, sha }), 201)
}

/** `PATCH /git/refs/{ref}`: moves a ref; without `force`, only forward. */
async function updateRef(
  c: Context,
  context: GithubRouteContext,
  where: { owner: string; repo: string; tail: string },
) {
  const { gh, repo } = repoAccess(c, context, WRITE, where)
  const name = `refs/${where.tail}`
  const current = refOf(gh, repo.id, name)
  const body = await bodyOf(c)
  const sha = stringField(body, "sha") ?? ""

  if (!current) throw invalid([], "Reference does not exist")
  if (!gh.commits.findOneBy("sha", sha)) throw invalid([], "Object does not exist")
  if (body.force !== true && !history(gh, sha).some((commit) => commit.sha === current.sha))
    throw invalid([], "Update is not a fast forward")
  setRef(gh, repo.id, name, sha)

  return c.json(refObject(repo, { ref: name, sha }))
}

/** Commits, branches and refs. */
export function commitRoutes(context: GithubRouteContext): void {
  const { app } = context
  const repoPath = "/repos/:owner/:repo"

  app.get(`${repoPath}/commits`, (c) => listCommits(c, context))
  app.get(`${repoPath}/commits/:ref`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const commit = resolveCommit(gh, repo.id, c.req.param("ref"))

    if (!commit) throw new GithubApiError(422, `No commit found for SHA: ${c.req.param("ref")}`)

    const parent = commit.parents[0] ? gh.commits.findOneBy("sha", commit.parents[0]) : undefined

    return c.json(commitObject(gh, repo, commit, diffTrees(gh, parent?.tree ?? {}, commit.tree)))
  })

  app.get(`${repoPath}/branches`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(paged(c, branchesOf(gh, repo.id)).map((branch) => shortBranch(repo, branch)))
  })
  app.get(`${repoPath}/branches/:branch`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const head = branchHead(gh, repo.id, c.req.param("branch"))

    if (!head) throw new GithubApiError(404, "Branch not found")

    return c.json(branchObject(gh, repo, c.req.param("branch"), head))
  })

  app.post(`${repoPath}/git/refs`, (c) => createRef(c, context))
  tailRoute(app, "GET", "git/ref", (c, where) => {
    const { gh, repo } = repoAccess(c, context, READ, where)
    const ref = refOf(gh, repo.id, `refs/${where.tail}`)

    if (!ref) throw notFound()

    return c.json(refObject(repo, ref))
  })
  tailRoute(app, "GET", "git/matching-refs", (c, where) => {
    const { gh, repo } = repoAccess(c, context, READ, where)
    const refs = gh.refs
      .findBy("repoId", repo.id)
      .filter((ref) => ref.ref.startsWith(`refs/${where.tail}`))

    return c.json(refs.map((ref) => refObject(repo, ref)))
  })
  tailRoute(app, "PATCH", "git/refs", (c, where) => updateRef(c, context, where))
  tailRoute(app, "DELETE", "git/refs", (c, where) => {
    const { gh, repo } = repoAccess(c, context, WRITE, where)
    const ref = refOf(gh, repo.id, `refs/${where.tail}`)

    if (!ref) throw invalid([], "Reference does not exist")
    gh.refs.delete(ref.id)

    return c.body(null, 204)
  })
}
