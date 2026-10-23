import type { Context } from "../../http.ts"
import {
  accessTo,
  type Caller,
  callerOf,
  findRepo,
  isMember,
  repoAccess,
  requireUser,
} from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubAccount, GithubRepoRecord } from "../entities.ts"
import { repositoryObject } from "../formatters.ts"
import { commitTo } from "../git.ts"
import {
  bodyOf,
  GithubApiError,
  invalid,
  missingField,
  nextGhId,
  notFound,
  paged,
  stringField,
} from "../helpers.ts"
import type { GithubStore } from "../store.ts"

/** Whether a person's token may see private repositories they have access to. */
const seesPrivate = (caller: Extract<Caller, { kind: "user" }>) =>
  caller.app !== undefined || caller.scopes.includes("repo")

function listOf(
  c: Context,
  gh: GithubStore,
  repos: readonly GithubRepoRecord[],
  caller: Caller,
): Response {
  const sorted = repos.toSorted((a, b) =>
    `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`),
  )
  const access = caller.kind === "anonymous" ? "anonymous" : "read"

  return c.json(
    paged(c, sorted).map((repo) => repositoryObject(gh, repo, { as: "listed", access })),
  )
}

/** The repositories of `owner` the caller may see. */
function visibleRepos(gh: GithubStore, caller: Caller, owner: string): GithubRepoRecord[] {
  return gh.repos.findBy("owner", owner).filter((repo) => {
    if (!repo.private) return true

    return caller.kind === "user" && seesPrivate(caller) && isMember(gh, caller.account, repo)
  })
}

/** Who may create repositories under `owner`: the person, or a member of the organisation. */
function checkOwner(gh: GithubStore, account: GithubAccount, owner: GithubAccount): void {
  const allowed = owner.login === account.login || owner.members.includes(account.login)

  if (!allowed)
    throw new GithubApiError(
      403,
      "You need admin access to the organization before adding a repository to it.",
    )
}

/** The README GitHub writes when a repository is created with `auto_init`. */
function initialCommit(
  gh: GithubStore,
  repo: GithubRepoRecord,
  account: GithubAccount,
  when: string,
): void {
  const readme = `# ${repo.name}\n${repo.description ? `\n${repo.description}\n` : ""}`

  commitTo(gh, repo, repo.defaultBranch, {
    files: { "README.md": Buffer.from(readme) },
    message: "Initial commit",
    author: {
      name: account.name ?? account.login,
      email: account.email ?? `${account.login}@users.noreply.github.com`,
      date: when,
    },
  })
}

/** The new repository's name, checked: given, not taken, and the token may create repositories. */
function newRepoName(
  gh: GithubStore,
  caller: Extract<Caller, { kind: "user" }>,
  owner: GithubAccount,
  name: string | undefined,
): string {
  if (!name) throw missingField("Repository", "name")
  if (findRepo(gh, owner.login, name))
    throw invalid(
      [
        {
          resource: "Repository",
          code: "custom",
          field: "name",
          message: "name already exists on this account",
        },
      ],
      "Repository creation failed.",
    )
  if (!seesPrivate(caller) && !caller.scopes.includes("public_repo")) throw notFound()

  return name
}

/** `POST /user/repos` and `POST /orgs/{org}/repos`. */
async function createRepo(
  c: Context,
  context: GithubRouteContext,
  ownerLogin?: string,
): Promise<Response> {
  const caller = requireUser(c, context)
  const gh = context.github()
  const body = await bodyOf(c)
  const owner = gh.accounts.findOneBy("login", ownerLogin ?? caller.account.login)

  if (!owner) throw notFound()
  checkOwner(gh, caller.account, owner)

  const name = newRepoName(gh, caller, owner, stringField(body, "name"))
  const repo = gh.repos.insert({
    ghId: nextGhId(context.store),
    owner: owner.login,
    name,
    private: body.private === true || body.visibility === "private",
    description: stringField(body, "description") ?? null,
    homepage: stringField(body, "homepage") ?? null,
    defaultBranch: "main",
    archived: false,
    topics: [],
    nextNumber: 1,
  })

  if (body.auto_init === true)
    initialCommit(gh, repo, caller.account, context.clock().toISOString())

  return c.json(repositoryObject(gh, repo), 201)
}

/** Repositories: one by name, the lists for a person and an organisation, and creating one. */
export function repoRoutes(context: GithubRouteContext): void {
  const { app } = context

  app.get("/repos/:owner/:repo", (c) => {
    const { gh, repo, caller } = repoAccess(c, context, { permission: "metadata", write: false })

    return c.json(
      repositoryObject(gh, repo, { as: "full", access: accessTo(c, context, repo, caller) }),
    )
  })

  app.get("/user/repos", (c) => {
    const caller = requireUser(c, context)
    const gh = context.github()
    const owners = [
      caller.account.login,
      ...gh.accounts
        .all()
        .filter((a) => a.members.includes(caller.account.login))
        .map((a) => a.login),
    ]

    return listOf(
      c,
      gh,
      owners.flatMap((owner) => visibleRepos(gh, caller, owner)),
      caller,
    )
  })

  app.get("/users/:username/repos", (c) => {
    const gh = context.github()

    return listOf(
      c,
      gh,
      gh.repos.findBy("owner", c.req.param("username")).filter((repo) => !repo.private),
      callerOf(c, context),
    )
  })

  app.get("/orgs/:org/repos", (c) => {
    const gh = context.github()

    const caller = callerOf(c, context)

    return listOf(c, gh, visibleRepos(gh, caller, c.req.param("org")), caller)
  })

  app.post("/user/repos", (c) => createRepo(c, context))
  app.post("/orgs/:org/repos", (c) => createRepo(c, context, c.req.param("org")))
}
