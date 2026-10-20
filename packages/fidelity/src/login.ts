/**
 * `danwo fidelity login google|microsoft`: signs a test account in through the provider's own
 * consent page and keeps the refresh token in `.env.fidelity`, so the Google and Microsoft suites
 * can run live. The redirect lands on a server danwo runs on this machine for the length of the
 * sign-in; the code is exchanged with PKCE and a checked `state`, and the token is never printed.
 */
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"

import {
  type AccountApp,
  accountApp,
  checkAccount,
  tenantOf,
  WorkAccountRefused,
} from "./accounts.ts"
import { writeEnvValue } from "./env-file.ts"
import { listenForRedirect, LoginError, type Redirect } from "./loopback.ts"
import { fidelityEnvironment } from "./provider.ts"

export { LoginError } from "./loopback.ts"

/** Where the consent page sends the browser back when no redirect URI is configured. */
const DEFAULT_PORT = 8765
const DEFAULT_PATH = "/callback"
const FIVE_MINUTES = 5 * 60_000

export interface LoginOptions {
  /** `google` or `microsoft`. */
  readonly provider: string
  /** The repository root, where `.env.fidelity` is read and written. */
  readonly root: string
  /** The port of the default redirect URI, `http://127.0.0.1:<port>/callback`. */
  readonly port?: number
  /**
   * The redirect URI to use instead, e.g. one an existing OAuth client already registers. danwo
   * listens on its host, port and path. Also read from `DANWO_FIDELITY_<PROVIDER>_REDIRECT_URI`.
   */
  readonly redirectUri?: string
  readonly write?: (line: string) => void
  /** Opens the consent page; the system browser by default. */
  readonly openBrowser?: (url: string) => void | Promise<void>
  /** Sends the token and account requests; the network by default. */
  readonly fetch?: (request: Request) => Promise<Response>
  /** How long to wait for the consent page to send the browser back. */
  readonly timeoutMs?: number
  /** The variables to read, instead of the environment and the root's env files. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** What the token endpoint answers, in the parts the login reads. */
interface Tokens {
  readonly access_token?: string
  readonly refresh_token?: string
  readonly scope?: string
  readonly error?: string
  readonly error_description?: string
}

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url")
}

/** A PKCE verifier and its S256 challenge. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))

  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) }
}

/** Opens `url` in the system browser, quietly doing nothing where that is not possible. */
function systemBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]

  try {
    spawn(command, args, { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref()
  } catch {
    /* The URL is printed too, to open by hand. */
  }
}

/** The client id and secret `app` signs in with, or a {@link LoginError} naming what is missing. */
function clientOf(
  app: AccountApp,
  env: Readonly<Record<string, string | undefined>>,
): { id: string; secret: string } {
  const id = env[app.variables.clientId]?.trim()
  const secret = env[app.variables.clientSecret]?.trim()

  if (!id || !secret)
    throw new LoginError(
      `set ${app.variables.clientId} and ${app.variables.clientSecret} in .env.fidelity first: the ${app.label} OAuth client to sign in with (\`danwo guide fidelity\` shows how to make one)`,
    )

  return { id, secret }
}

/** The redirect URI to use: the option, then the provider's variable, then danwo's default. */
function redirectOf(
  options: LoginOptions,
  app: AccountApp,
  env: Readonly<Record<string, string | undefined>>,
): URL {
  const given = options.redirectUri ?? env[app.variables.redirectUri]?.trim()
  const text = given || `http://127.0.0.1:${options.port ?? DEFAULT_PORT}${DEFAULT_PATH}`

  try {
    return new URL(text)
  } catch {
    throw new LoginError(`${text} is not a URL; give the redirect URI the OAuth client registers`)
  }
}

/** The consent page's address, asking for `app`'s scopes and a refresh token. */
function consentUrl(
  app: AccountApp,
  tenant: string,
  client: string,
  redirect: URL,
  state: string,
  challenge: string,
): string {
  const url = new URL(app.authorizeUrl(tenant))

  for (const [key, value] of Object.entries({
    client_id: client,
    redirect_uri: redirect.href,
    response_type: "code",
    scope: app.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...app.offlineParams,
  }))
    url.searchParams.set(key, value)

  return url.href
}

/** The authorization code the redirect carries, after its `state` and any error are checked. */
function codeOf(redirect: Redirect, state: string, uri: URL): string {
  const { params } = redirect
  const error = params.get("error")

  if (error === "access_denied")
    throw new LoginError("the sign-in was cancelled on the consent page")
  if (error !== null)
    throw new LoginError(
      `the consent page refused: ${error}${params.has("error_description") ? ` (${params.get("error_description") ?? ""})` : ""}. Check that ${uri.href} is a redirect URI the client registers`,
    )
  if (params.get("state") !== state)
    throw new LoginError("the redirect's state does not match this sign-in; start it again")

  const code = params.get("code")

  if (code === null || code === "")
    throw new LoginError("the redirect carried no authorization code")

  return code
}

/** Reads a JSON answer, or an empty object for anything else. */
async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json()

    return typeof body === "object" && body !== null ? { ...body } : {}
  } catch {
    return {}
  }
}

/** Exchanges the code for tokens; a refusal names what to fix. */
async function exchange(
  send: (request: Request) => Promise<Response>,
  url: string,
  form: Readonly<Record<string, string>>,
  redirect: URL,
): Promise<Tokens> {
  const response = await send(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    }),
  )
  const tokens: Tokens = await jsonOf(response)

  if (tokens.error === "redirect_uri_mismatch" || tokens.error === "invalid_request")
    throw new LoginError(
      `the token endpoint refused the redirect URI: register exactly ${redirect.href} on the OAuth client, or pass the one it has with --redirect-uri`,
    )
  if (!response.ok || tokens.error !== undefined)
    throw new LoginError(
      `the token endpoint refused the code: ${tokens.error ?? response.status}${tokens.error_description ? ` (${tokens.error_description})` : ""}`,
    )

  return tokens
}

/** The address of the account `token` belongs to. */
async function accountEmail(
  send: (request: Request) => Promise<Response>,
  app: AccountApp,
  token: string,
): Promise<string> {
  const response = await send(
    new Request(app.whoAmI, { headers: { authorization: `Bearer ${token}` } }),
  )
  const email = app.emailOf(await jsonOf(response))

  if (!response.ok || email === undefined)
    throw new LoginError(`could not read which ${app.label} account signed in (${response.status})`)

  return email
}

/** Prints what will happen, then opens the consent page. */
async function showConsent(
  options: LoginOptions,
  app: AccountApp,
  redirect: URL,
  url: string,
  write: (line: string) => void,
): Promise<void> {
  write(`Signing a ${app.label} test account in for the fidelity suites. It is asked for:`)
  for (const scope of app.scopes) write(`  ${scope}`)
  write(`The consent page sends the browser back to ${redirect.href}; the client must register it.`)
  write(`Sign in with a test account, not your own. If the browser does not open, go to:\n  ${url}`)

  await (options.openBrowser ?? systemBrowser)(url)
}

/** Waits for the redirect, with what to check when it never comes. */
async function awaitRedirect(
  listening: { redirect: Promise<Redirect> },
  timeoutMs: number,
  uri: URL,
): Promise<Redirect> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new LoginError(
            `no answer from the consent page after ${Math.round(timeoutMs / 1000)} s. If it showed redirect_uri_mismatch, register ${uri.href} on the client or pass its own with --redirect-uri`,
          ),
        ),
      timeoutMs,
    )
  })

  try {
    return await Promise.race([listening.redirect, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The account provider to sign in to, or a {@link LoginError} for any other name. */
function appNamed(name: string): AccountApp {
  if (name !== "google" && name !== "microsoft")
    throw new LoginError(
      "name the provider: danwo fidelity login google, or danwo fidelity login microsoft",
    )

  return accountApp(name)
}

/** Runs the sign-in and keeps the refresh token. */
async function signIn(options: LoginOptions, write: (line: string) => void): Promise<void> {
  const app = appNamed(options.provider)
  const env = options.env ?? fidelityEnvironment(options.root)
  const client = clientOf(app, env)
  const redirect = redirectOf(options, app, env)
  const tenant = tenantOf(app, env)
  const send = options.fetch ?? ((request: Request) => fetch(request))
  const state = base64url(randomBytes(16))
  const { verifier, challenge } = pkce()
  const listening = await listenForRedirect(redirect)

  try {
    await showConsent(
      options,
      app,
      redirect,
      consentUrl(app, tenant, client.id, redirect, state, challenge),
      write,
    )

    const code = codeOf(
      await awaitRedirect(listening, options.timeoutMs ?? FIVE_MINUTES, redirect),
      state,
      redirect,
    )
    const tokens = await exchange(
      send,
      app.tokenUrl(tenant),
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect.href,
        client_id: client.id,
        client_secret: client.secret,
        code_verifier: verifier,
      },
      redirect,
    )

    await keep(options, app, env, send, tokens, write)
  } finally {
    await listening.close()
  }
}

/** Writes the refresh token for the signed-in account, with a warning when it looks like a work one. */
async function keep(
  options: LoginOptions,
  app: AccountApp,
  env: Readonly<Record<string, string | undefined>>,
  send: (request: Request) => Promise<Response>,
  tokens: Tokens,
  write: (line: string) => void,
): Promise<void> {
  if (!tokens.refresh_token)
    throw new LoginError(
      `${app.label} gave no refresh token. Remove the app's access from the account's security settings and sign in again`,
    )

  const email = await accountEmail(send, app, tokens.access_token ?? "")

  await writeEnvValue(
    join(options.root, ".env.fidelity"),
    app.variables.refreshToken,
    tokens.refresh_token,
  )
  write(`Saved ${app.variables.refreshToken} in .env.fidelity for ${email}.`)
  write(`Granted: ${tokens.scope ?? app.scopes.join(" ")}`)

  try {
    checkAccount(app, email, env)
  } catch (error) {
    if (!(error instanceof WorkAccountRefused)) throw error
    write(
      `Note: live runs will refuse ${email} until ${app.variables.account}=${email} is set: it does not look like a personal account.`,
    )
  }

  write(`Run the live suite with: danwo fidelity ${app.provider}`)
}

/** Signs a test account in and keeps its refresh token; the exit code is 1 when it could not. */
export async function loginCommand(options: LoginOptions): Promise<number> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))

  try {
    await signIn(options, write)

    return 0
  } catch (error) {
    if (!(error instanceof LoginError)) throw error
    write(`danwo fidelity login: ${error.message}`)

    return 1
  }
}
