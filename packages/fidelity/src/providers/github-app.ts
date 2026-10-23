/**
 * Acting as the GitHub App the suite is installed with: a JWT signed with the App's key, an
 * installation token limited to the one sandbox repository, and requests sent with either. The
 * token is revoked when the scenario ends, and its value is never shaped, printed or kept.
 */
import { createSign } from "node:crypto"
import { readFileSync } from "node:fs"

import type { ScenarioContext, Target } from "../scenario.ts"
import { asJsonObject, type Json, readJson, stringField } from "../shape.ts"

export const API = "https://api.github.com"

/** The variables a run with the App reads. */
export const APP_VARIABLES = {
  appId: "DANWO_FIDELITY_GITHUB_APP_ID",
  privateKey: "DANWO_FIDELITY_GITHUB_APP_PRIVATE_KEY",
  privateKeyPath: "DANWO_FIDELITY_GITHUB_APP_PRIVATE_KEY_PATH",
  installationId: "DANWO_FIDELITY_GITHUB_INSTALLATION_ID",
  repo: "DANWO_FIDELITY_GITHUB_REPO",
} as const

/** Why an App scenario is skipped when the variables are not all set. */
export const APP_MISSING = `set ${APP_VARIABLES.appId}, ${APP_VARIABLES.privateKey} (or ${APP_VARIABLES.privateKeyPath}), ${APP_VARIABLES.installationId} and ${APP_VARIABLES.repo} to run the GitHub App scenarios`

/** The App's credentials as a target carries them. */
export interface AppCredentials {
  readonly appId: string
  readonly privateKey: string
  readonly installationId: string
  /** `owner/name` of the sandbox repository, the only one tokens are minted for. */
  readonly repo: string
}

function trimmed(env: Readonly<Record<string, string | undefined>>, name: string): string {
  return env[name]?.trim() ?? ""
}

/**
 * The App's private key: the PEM itself (its line breaks may be written as `\n`, since an env
 * file holds one line per variable), or read from the file a path names.
 */
function privateKeyOf(env: Readonly<Record<string, string | undefined>>): string {
  const inline = trimmed(env, APP_VARIABLES.privateKey)

  if (inline !== "") return inline.replaceAll("\\n", "\n")

  const path = trimmed(env, APP_VARIABLES.privateKeyPath)

  if (path === "") return ""

  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    throw new Error(`could not read the private key file ${APP_VARIABLES.privateKeyPath} names`)
  }
}

/** The App's credentials from `env`, or undefined when any of them is missing. */
export function appCredentials(
  env: Readonly<Record<string, string | undefined>>,
): AppCredentials | undefined {
  const appId = trimmed(env, APP_VARIABLES.appId)
  const installationId = trimmed(env, APP_VARIABLES.installationId)
  const repo = trimmed(env, APP_VARIABLES.repo)

  if (appId === "" || installationId === "" || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return undefined

  const privateKey = privateKeyOf(env)

  return privateKey === "" ? undefined : { appId, privateKey, installationId, repo }
}

/** The App's credentials a target holds, or undefined for a target with only public access. */
export function targetApp(target: Target): AppCredentials | undefined {
  const { appId, privateKey, installationId, repo } = target.credentials

  if (
    appId === undefined ||
    privateKey === undefined ||
    installationId === undefined ||
    repo === undefined
  )
    return undefined

  return { appId, privateKey, installationId, repo }
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

/**
 * A JWT for the App: issued a minute ago against clock drift, valid for nine minutes, under the ten
 * GitHub allows.
 */
export function appJwt(app: AppCredentials): string {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({
    iat: now - 60,
    exp: now + 540,
    iss: app.appId,
  })}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(app.privateKey, "base64url")

  return `${unsigned}.${signature}`
}

/** A REST request as GitHub asks for it, authorized with `auth` (a JWT or a token) when given. */
export function githubRequest(
  method: string,
  path: string,
  options: { readonly auth?: string; readonly body?: unknown } = {},
): Request {
  return new Request(`${API}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "danwo-fidelity",
      "x-github-api-version": "2022-11-28",
      ...(options.auth !== undefined && { authorization: `Bearer ${options.auth}` }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  })
}

/** The sandbox repository's name without its owner, as the access token request takes it. */
const repoName = (app: AppCredentials) => app.repo.split("/")[1] ?? app.repo

/** The body that asks for a token limited to the sandbox repository, and to `permissions` if set. */
export function tokenRequestBody(
  app: AppCredentials,
  permissions?: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return { repositories: [repoName(app)], ...(permissions && { permissions }) }
}

/** The token in an access token answer; an answer without one is a failed run. */
function tokenOf(body: Json): string {
  const token = stringField(body, "token")

  if (token === "") throw new Error("GitHub gave no installation token")

  return token
}

/** Why GitHub refused to mint a token, worded as what to fix. */
const NOT_INSTALLED = `GitHub knows no installation ${APP_VARIABLES.installationId} names for this App; install the App on the sandbox repository and copy the id from the installation's settings URL`

/** Sends `request` without recording it, for setup a scenario does not compare; refusals throw. */
async function sendOk(target: Target, request: Request, what: string): Promise<Json> {
  const response = await target.send(request)

  if (!response.ok) throw new Error(`${what}: GitHub answered ${response.status}`)

  return readJson(response)
}

/** The token in an access token answer; a 404 means the installation id is not the App's. */
export function mintedToken(answer: { readonly status: number; readonly body: Json }): string {
  if (answer.status === 404) throw new Error(NOT_INSTALLED)

  return tokenOf(answer.body)
}

/** Mints an installation token for the sandbox repository, without recording the call. */
export async function mintToken(
  target: Target,
  app: AppCredentials,
  permissions?: Readonly<Record<string, string>>,
): Promise<string> {
  const response = await target.send(
    githubRequest("POST", `/app/installations/${app.installationId}/access_tokens`, {
      auth: appJwt(app),
      body: tokenRequestBody(app, permissions),
    }),
  )
  const body = await readJson(response)

  if (!response.ok && response.status !== 404)
    throw new Error(`mint an installation token: GitHub answered ${response.status}`)

  return mintedToken({ status: response.status, body })
}

/** Writes down a token to revoke when the scenario ends; `label` names it, never its value. */
export function revokeLater(context: ScenarioContext, token: string, label: string): void {
  context.created({
    kind: "installation token",
    id: `${label}-${context.unique}`,
    undo: () =>
      context.target.send(githubRequest("DELETE", "/installation/token", { auth: token })),
    /* A token that already expired or was revoked answers 401: nothing is left to undo. */
    settled: (status) => status === 401,
  })
}

/** The App's credentials, or the scenario is skipped because the target has none. */
export function requireApp(context: ScenarioContext): AppCredentials {
  const app = targetApp(context.target)

  if (app === undefined) context.skip(APP_MISSING)

  return app
}

/** A scenario's way into the sandbox repository: a token for it, and requests under it. */
export interface RepoSession {
  readonly app: AppCredentials
  readonly token: string
  /** A request to `/repos/<owner>/<repo><path>` with the session's token. */
  call(method: string, path: string, body?: unknown): Request
}

/** Opens a session on the sandbox repository: a token minted unrecorded, revoked at the end. */
export async function openSession(context: ScenarioContext): Promise<RepoSession> {
  const app = requireApp(context)
  const token = await mintToken(context.target, app)

  revokeLater(context, token, "session")

  return {
    app,
    token,
    call: (method, path, body) =>
      githubRequest(method, `/repos/${app.repo}${path}`, { auth: token, body }),
  }
}

/** A field of an answer that a later call needs; a missing one fails the scenario. */
export function required(body: Json, path: readonly string[]): string | number {
  let value: Json | undefined = body

  for (const key of path) value = asJsonObject(value)?.[key]

  if (typeof value !== "string" && typeof value !== "number")
    throw new Error(`expected the answer to have ${path.join(".")}`)

  return value
}

/** A branch the scenario made from the default branch, with the commit a file added to it. */
export interface ScratchBranch {
  readonly name: string
  readonly file: string
  /** The commit the file was added in: the branch's head. */
  readonly head: string
}

/**
 * GitHub's answer to deleting a branch already gone: a 422 that leaves nothing to do, as when a
 * scenario deleted it itself.
 */
function branchGone(status: number, body: string): boolean {
  return status === 422 && /Reference does not exist/i.test(body)
}

/** Writes down a branch to delete when the scenario ends. */
export function deleteBranchLater(context: ScenarioContext, session: RepoSession, name: string) {
  context.created({
    kind: "branch",
    id: name,
    undo: () => context.target.send(session.call("DELETE", `/git/refs/heads/${name}`)),
    settled: branchGone,
  })
}

/** The file a scenario adds to its branch: named and marked with the run's tag. */
export function scratchFile(context: ScenarioContext) {
  return {
    path: `${context.tag}.md`,
    text: `# ${context.tag}\n\nWritten by a danwo fidelity check; the branch is deleted after it.\n`,
  }
}

/**
 * Makes a branch named after the run's tag from the default branch and adds a file to it, both
 * unrecorded; the branch is deleted when the scenario ends.
 */
export async function scratchBranch(
  context: ScenarioContext,
  session: RepoSession,
  base = "main",
): Promise<ScratchBranch> {
  const name = context.tag
  const ref = await sendOk(
    context.target,
    session.call("GET", `/git/ref/heads/${base}`),
    `read ${base}`,
  )

  await sendOk(
    context.target,
    session.call("POST", "/git/refs", {
      ref: `refs/heads/${name}`,
      sha: required(ref, ["object", "sha"]),
    }),
    "create a branch",
  )
  deleteBranchLater(context, session, name)

  const file = scratchFile(context)
  const put = await sendOk(
    context.target,
    session.call("PUT", `/contents/${file.path}`, {
      message: `Add ${file.path}`,
      content: Buffer.from(file.text).toString("base64"),
      branch: name,
    }),
    "add a file to the branch",
  )

  return { name, file: file.path, head: String(required(put, ["commit", "sha"])) }
}
