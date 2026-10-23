import type { components } from "@octokit/openapi-types"

import type { Context } from "../../http.ts"
import { randomToken } from "../../oauth/tokens.ts"
import {
  credentialOf,
  findRepo,
  installationRepos,
  requireApp,
  requireInstallation,
} from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubAppRecord, GithubInstallationRecord, GithubRepoRecord } from "../entities.ts"
import { appObject, installationObject, repositoryObject } from "../formatters.ts"
import { bodyOf, ghTime, invalid, notFound, paged, stringsField } from "../helpers.ts"
import type { GithubStore } from "../store.ts"

type Schemas = components["schemas"]

const TOKEN_SECONDS = 3600

/** One of the app's installations, or a 404. */
function ownInstallation(
  gh: GithubStore,
  app: GithubAppRecord,
  id: number,
): GithubInstallationRecord {
  const installation = gh.installations.findOneBy("ghId", id)

  if (!installation || installation.appId !== app.ghId) throw notFound()

  return installation
}

/** How much a permission level allows: none, then read, write and admin. */
const rank = (level: string | undefined) => ["read", "write", "admin"].indexOf(level ?? "")

/** The permissions a token asks for, checked against what the app was granted. */
function tokenPermissions(app: GithubAppRecord, asked: unknown): Record<string, string> {
  if (typeof asked !== "object" || asked === null) return { ...app.permissions }

  const wanted = Object.entries(asked).map(([name, level]) => [name, String(level)] as const)
  const granted = wanted.every(([name, level]) => rank(app.permissions[name]) >= rank(level))

  if (!granted) throw invalid([], "The permissions requested are not granted to this installation.")

  return Object.fromEntries(wanted)
}

/** The repositories a token asks for by name or id, all of which the installation must cover. */
function tokenRepos(
  gh: GithubStore,
  installation: GithubInstallationRecord,
  body: Record<string, unknown>,
) {
  const names = stringsField(body, "repositories")
  const ids = Array.isArray(body.repository_ids) ? body.repository_ids.map(Number) : undefined

  if (!names && !ids) return null

  const covered = installationRepos(gh, installation)
  const picked = covered.filter((repo) => names?.includes(repo.name) || ids?.includes(repo.ghId))

  if (picked.length !== (names?.length ?? 0) + (ids?.length ?? 0))
    throw invalid(
      [],
      "There is at least one repository that does not exist or is not accessible to the parent installation.",
    )

  return picked
}

async function createToken(c: Context, context: GithubRouteContext): Promise<Response> {
  const gh = context.github()
  const app = requireApp(c, context)
  const installation = ownInstallation(gh, app, Number(c.req.param("id")))
  const body = await bodyOf(c)

  if (installation.suspended) throw invalid([], "This installation has been suspended")

  const permissions = tokenPermissions(app, body.permissions)
  const repos = tokenRepos(gh, installation, body)
  const expiresAt = new Date(context.clock().getTime() + TOKEN_SECONDS * 1000).toISOString()
  const token = gh.installationTokens.insert({
    token: randomToken("ghs_", 27),
    installationId: installation.ghId,
    repoIds: repos && repos.map((repo) => repo.ghId),
    permissions,
    expiresAt,
  })

  return c.json(
    {
      token: token.token,
      expires_at: ghTime(expiresAt),
      permissions,
      repository_selection: repos ? "selected" : installation.repositorySelection,
      ...(repos && {
        repositories: repos.map((repo) =>
          repositoryObject(gh, repo, { as: "nested", access: "push" }),
        ),
      }),
    } satisfies Schemas["installation-token"],
    201,
  )
}

/** The app's installation on an account or repository, for `GET …/installation`. */
function installationOn(
  c: Context,
  context: GithubRouteContext,
  account: string,
  repo?: GithubRepoRecord,
) {
  const gh = context.github()
  const app = requireApp(c, context)
  const installation = gh.installations
    .all()
    .find(
      (candidate) =>
        candidate.appId === app.ghId &&
        candidate.account.toLowerCase() === account.toLowerCase() &&
        (!repo || installationRepos(gh, candidate).some((r) => r.id === repo.id)),
    )

  if (!installation) throw notFound()

  return c.json(installationObject(gh, installation))
}

/** GitHub App authentication: the app itself, its installations and installation tokens. */
export function appRoutes(context: GithubRouteContext): void {
  const { app } = context

  app.get("/app", (c) => c.json(appObject(context.github(), requireApp(c, context))))

  app.get("/app/installations", (c) => {
    const gh = context.github()
    const own = gh.installations.findBy("appId", requireApp(c, context).ghId)

    return c.json(paged(c, own).map((installation) => installationObject(gh, installation)))
  })

  app.get("/app/installations/:id", (c) => {
    const gh = context.github()

    return c.json(
      installationObject(
        gh,
        ownInstallation(gh, requireApp(c, context), Number(c.req.param("id"))),
      ),
    )
  })

  app.post("/app/installations/:id/access_tokens", (c) => createToken(c, context))

  app.get("/installation/repositories", (c) => {
    const gh = context.github()
    const caller = requireInstallation(c, context)
    const repos = installationRepos(gh, caller.installation).filter(
      (repo) => caller.repoIds === null || caller.repoIds.includes(repo.ghId),
    )

    return c.json({
      total_count: repos.length,
      repository_selection: caller.installation.repositorySelection,
      repositories: paged(c, repos).map((repo) =>
        repositoryObject(gh, repo, { as: "listed", access: "read" }),
      ),
    })
  })

  app.delete("/installation/token", (c) => {
    const gh = context.github()

    requireInstallation(c, context)

    const token = gh.installationTokens.findOneBy("token", credentialOf(c) ?? "")

    if (token) gh.installationTokens.delete(token.id)

    return c.body(null, 204)
  })

  app.get("/repos/:owner/:repo/installation", (c) => {
    const repo = findRepo(context.github(), c.req.param("owner"), c.req.param("repo"))

    if (!repo) throw notFound()

    return installationOn(c, context, repo.owner, repo)
  })
  app.get("/users/:username/installation", (c) =>
    installationOn(c, context, c.req.param("username")),
  )
  app.get("/orgs/:org/installation", (c) => installationOn(c, context, c.req.param("org")))
}
