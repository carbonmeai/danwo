import { createPublicKey, createVerify } from "node:crypto"

import type { Context } from "../http.ts"
import { liveToken } from "../oauth/tokens.ts"
import type { Clock } from "../store.ts"
import type { GithubRouteContext } from "./context.ts"
import type {
  GithubAccount,
  GithubAppRecord,
  GithubInstallationRecord,
  GithubRepoRecord,
} from "./entities.ts"
import { GithubApiError, notFound } from "./helpers.ts"
import type { GithubStore } from "./store.ts"

/**
 * Who a request acts as, from its `Authorization` header (`token …` or `Bearer …`):
 * - a person, through an OAuth token, a GitHub App user token or a personal access token, with
 *   the scopes they granted (a GitHub App user token instead carries its app's permissions);
 * - a GitHub App, through a JWT signed with its private key;
 * - an installation, through an installation token;
 * - nobody, without the header.
 */
export type Caller =
  | {
      readonly kind: "user"
      readonly account: GithubAccount
      readonly scopes: readonly string[]
      /** For a GitHub App user token, the app it acts through. */
      readonly app: GithubAppRecord | undefined
    }
  | { readonly kind: "app"; readonly app: GithubAppRecord }
  | {
      readonly kind: "installation"
      readonly installation: GithubInstallationRecord
      readonly permissions: Readonly<Record<string, string>>
      readonly repoIds: readonly number[] | null
    }
  | { readonly kind: "anonymous" }

/** The credential in the `Authorization` header, if any. */
export function credentialOf(c: Context): string | undefined {
  return /^(?:token|bearer)\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1]
}

const badCredentials = () => new GithubApiError(401, "Bad credentials")

const notIntegration = () => new GithubApiError(403, "Resource not accessible by integration")

interface JwtClaims {
  readonly iss?: unknown
  readonly iat?: unknown
  readonly exp?: unknown
}

/** The claims of a JWT, or a 401 when they cannot be read. */
function decodeJwt(jwt: string): JwtClaims {
  const payload = jwt.split(".")[1] ?? ""

  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))

    return typeof claims === "object" && claims !== null ? claims : {}
  } catch {
    throw new GithubApiError(401, "A JSON web token could not be decoded")
  }
}

/** Whether `jwt` is signed with the app's private key. */
function signedBy(jwt: string, app: GithubAppRecord): boolean {
  const [header = "", payload = "", signature = ""] = jwt.split(".")

  return createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(createPublicKey(app.privateKey), Buffer.from(signature, "base64url"))
}

/** The checks GitHub makes on an app JWT's times: issued, not expired, at most ten minutes long. */
function checkTimes(claims: JwtClaims, clock: Clock): void {
  const now = Math.floor(clock().getTime() / 1000)

  if (typeof claims.iat !== "number" || claims.iat > now + 60)
    throw new GithubApiError(
      401,
      "'Issued at' claim ('iat') must be an Integer representing the time that the assertion was issued.",
    )
  if (typeof claims.exp !== "number" || claims.exp <= now)
    throw new GithubApiError(
      401,
      "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires.",
    )
  if (claims.exp - claims.iat > 660)
    throw new GithubApiError(
      401,
      "'Expiration time' claim ('exp') is too far in the future. Use a time no more than 10 minutes from the issued at time.",
    )
}

/** The app an app JWT was signed by, after checking it. */
function appFromJwt(gh: GithubStore, jwt: string, clock: Clock): GithubAppRecord {
  const claims = decodeJwt(jwt)
  const app = gh.apps
    .all()
    .find(
      (candidate) =>
        candidate.kind === "github-app" &&
        (String(candidate.ghId) === String(claims.iss) || candidate.clientId === claims.iss),
    )

  if (!app) throw new GithubApiError(401, "Integration not found")
  if (!signedBy(jwt, app)) throw new GithubApiError(401, "A JSON web token could not be decoded")
  checkTimes(claims, clock)

  return app
}

function installationCaller(gh: GithubStore, credential: string, clock: Clock): Caller | undefined {
  const token = gh.installationTokens.findOneBy("token", credential)
  const installation = token && gh.installations.findOneBy("ghId", token.installationId)

  if (!token || !installation || Date.parse(token.expiresAt) <= clock().getTime()) return undefined

  return {
    kind: "installation",
    installation,
    permissions: token.permissions,
    repoIds: token.repoIds,
  }
}

function userCaller(gh: GithubStore, credential: string, clock: Clock): Caller | undefined {
  const pat = gh.pats.findOneBy("token", credential)

  if (pat) {
    const account = gh.accounts.findOneBy("login", pat.login)

    return account && { kind: "user", account, scopes: pat.scopes, app: undefined }
  }

  const token = liveToken(gh.tokens, credential, "access", clock)
  const account = token && gh.accounts.findOneBy("login", token.user)
  const app = token && gh.apps.findOneBy("clientId", token.clientId)

  return (
    account && {
      kind: "user",
      account,
      scopes: token.scope.split(",").filter(Boolean),
      app: app?.kind === "github-app" ? app : undefined,
    }
  )
}

/** Who the request acts as; an unknown, expired or revoked credential is a 401. */
export function callerOf(c: Context, context: GithubRouteContext): Caller {
  const credential = credentialOf(c)

  if (!credential) return { kind: "anonymous" }

  const gh = context.github()

  if (credential.split(".").length === 3)
    return { kind: "app", app: appFromJwt(gh, credential, context.clock) }

  const caller =
    installationCaller(gh, credential, context.clock) ?? userCaller(gh, credential, context.clock)

  if (!caller) throw badCredentials()

  return caller
}

/** The signed-in person, for endpoints only a user token can call. */
export function requireUser(c: Context, context: GithubRouteContext) {
  const caller = callerOf(c, context)

  if (caller.kind === "user") return caller
  if (caller.kind === "anonymous") throw new GithubApiError(401, "Requires authentication")

  throw notIntegration()
}

/** The app behind an app JWT, for the `/app` endpoints. */
export function requireApp(c: Context, context: GithubRouteContext): GithubAppRecord {
  const caller = callerOf(c, context)

  if (caller.kind === "app") return caller.app

  throw new GithubApiError(401, "A JSON web token could not be decoded")
}

/** The installation behind an installation token. */
export function requireInstallation(c: Context, context: GithubRouteContext) {
  const caller = callerOf(c, context)

  if (caller.kind === "installation") return caller

  throw new GithubApiError(403, "This endpoint requires an installation access token.")
}

/** What a request wants to do to a repository, as the permission it needs. */
export interface Need {
  /** The GitHub App permission this falls under: `issues`, `contents`, `checks` and so on. */
  readonly permission: string
  readonly write: boolean
}

/** The repositories an installation covers. */
export function installationRepos(gh: GithubStore, installation: GithubInstallationRecord) {
  return installation.repositorySelection === "all"
    ? gh.repos.findBy("owner", installation.account)
    : installation.repoIds.flatMap((id) => gh.repos.findBy("ghId", id))
}

/** Whether `permissions` grant `need` (`write` implies `read`; metadata is always readable). */
function grants(permissions: Readonly<Record<string, string>>, need: Need): boolean {
  if (need.permission === "metadata" && !need.write) return true

  const level = permissions[need.permission]

  return need.write ? level === "write" || level === "admin" : level !== undefined
}

/** Whether a person owns the repository or belongs to the organisation that does. */
export function isMember(gh: GithubStore, account: GithubAccount, repo: GithubRepoRecord): boolean {
  if (repo.owner === account.login) return true

  return gh.accounts.findOneBy("login", repo.owner)?.members.includes(account.login) ?? false
}

/** Permissions anyone has on a public repository: opening and commenting on issues and pulls. */
const OPEN_TO_ALL = ["issues", "pull_requests"]

/** Whether the person may do `need` on the repository at all, whatever their token's scopes. */
function personMay(gh: GithubStore, account: GithubAccount, repo: GithubRepoRecord, need: Need) {
  const member = isMember(gh, account, repo)

  if (need.permission === "repository_hooks") return member
  if (!need.write) return !repo.private || member

  return member || (!repo.private && OPEN_TO_ALL.includes(need.permission))
}

/** Whether a token's OAuth scopes cover `need`: `repo` for private repositories and writes. */
function scopesAllow(scopes: readonly string[], repo: GithubRepoRecord, need: Need): boolean {
  if (repo.private) return scopes.includes("repo")

  return !need.write || scopes.includes("repo") || scopes.includes("public_repo")
}

/** Whether a person's token reaches the repository for `need`. */
function userMay(
  gh: GithubStore,
  caller: Extract<Caller, { kind: "user" }>,
  repo: GithubRepoRecord,
  need: Need,
): boolean {
  const scoped = caller.app !== undefined || scopesAllow(caller.scopes, repo, need)

  return scoped && personMay(gh, caller.account, repo, need)
}

/**
 * Checks an installation token against the repository and `need`. A public repository the token
 * does not cover is still readable, as public data is to anyone, but refuses writes as out of the
 * integration's reach; a private one stays hidden behind a 404.
 */
function checkInstallation(
  gh: GithubStore,
  caller: Extract<Caller, { kind: "installation" }>,
  repo: GithubRepoRecord,
  need: Need,
): void {
  const covered = installationRepos(gh, caller.installation).some((r) => r.id === repo.id)
  const limited = caller.repoIds !== null && !caller.repoIds.includes(repo.ghId)

  if (caller.installation.suspended) throw notFound()

  if (!covered || limited) {
    if (repo.private) throw notFound()
    if (need.write) throw notIntegration()

    return
  }

  if (!grants(caller.permissions, need)) throw notIntegration()
}

/** Checks a GitHub App user token: the app must be installed on the repository with `need`. */
function checkAppUser(gh: GithubStore, app: GithubAppRecord, repo: GithubRepoRecord, need: Need) {
  const installed = gh.installations
    .all()
    .some(
      (installation) =>
        installation.appId === app.ghId &&
        installationRepos(gh, installation).some((r) => r.id === repo.id),
    )

  if (!installed || !grants(app.permissions, need)) throw notIntegration()
}

/** Refuses the request unless its caller may do `need` on `repo`. */
function authorize(
  c: Context,
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  need: Need,
): Caller {
  const gh = context.github()
  const caller = callerOf(c, context)

  switch (caller.kind) {
    case "installation":
      checkInstallation(gh, caller, repo, need)

      return caller
    case "user":
      if (!userMay(gh, caller, repo, need)) throw notFound()
      if (caller.app) checkAppUser(gh, caller.app, repo, need)

      return caller
    case "app":
      throw notIntegration()
    default:
      if (repo.private) throw notFound()
      if (need.write) throw new GithubApiError(401, "Requires authentication")

      return caller
  }
}

/**
 * Refuses an installation token whose permissions do not cover `need`, before anything else about
 * the request is looked at: GitHub checks a token's permissions for an endpoint first, then the
 * request's body, then the repository.
 */
export function requireGrant(c: Context, context: GithubRouteContext, need: Need): void {
  const caller = callerOf(c, context)

  if (caller.kind === "installation" && !grants(caller.permissions, need)) throw notIntegration()
}

/** What the caller may do with a repository it can read, as a repository answer shows it. */
export function accessTo(
  c: Context,
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  caller: Caller,
): "anonymous" | "read" | "push" {
  if (caller.kind === "anonymous") return "anonymous"

  try {
    authorize(c, context, repo, { permission: "contents", write: true })

    return "push"
  } catch {
    return "read"
  }
}

/** A repository by owner and name, compared case-insensitively as GitHub does. */
export function findRepo(gh: GithubStore, owner: string, name: string) {
  const [o, n] = [owner.toLowerCase(), name.toLowerCase()]

  return gh.repos
    .all()
    .find((repo) => repo.owner.toLowerCase() === o && repo.name.toLowerCase() === n)
}

/**
 * The repository a `/repos/{owner}/{repo}/…` request names (or `where`, for routes matched by
 * pattern), after checking the caller may do `need` on it; with the store and who the write is
 * attributed to.
 */
export function repoAccess(
  c: Context,
  context: GithubRouteContext,
  need: Need,
  where: { readonly owner: string; readonly repo: string } = {
    owner: c.req.param("owner"),
    repo: c.req.param("repo"),
  },
) {
  const gh = context.github()
  const repo = findRepo(gh, where.owner, where.repo)

  if (!repo) throw notFound()

  const caller = authorize(c, context, repo, need)

  return { gh, repo, caller, actor: actorOf(gh, caller) }
}

/** The login a write is attributed to: the person, or the app's bot account. */
function actorOf(gh: GithubStore, caller: Caller): string {
  if (caller.kind === "user") return caller.account.login

  if (caller.kind === "installation") {
    const app = gh.apps.findOneBy("ghId", caller.installation.appId)

    return `${app?.slug ?? "app"}[bot]`
  }

  return "ghost"
}
