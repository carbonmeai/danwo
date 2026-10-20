/**
 * Targets that act as a signed-in account, for the Google and Microsoft suites. A scenario marks
 * a request as the account's with {@link asAccount}; the target swaps in an access token it gets
 * from the refresh token, once, on the first such request. Live, the account is checked first:
 * a work account the suites were not told to use is refused before anything is created in it.
 */
import { createEmulator, type Emulator, type EmulatorDefinition } from "@danwo/emulators"

import { type AccountApp, checkAccount, tenantOf } from "./accounts.ts"
import { publicEndpointsAllowed, sendLive } from "./provider.ts"
import type { OpenTarget, ScenarioContext, Target } from "./scenario.ts"
import { type Json, readJson } from "./shape.ts"

/** The placeholder a scenario's request carries where the account's access token goes. */
const PLACEHOLDER = "danwo-fidelity-account"

/** The credential a target has when it can act as an account; scenarios skip without it. */
export const SIGNED_IN = "account"

/** A request made as the signed-in account: the target puts the access token in. */
export function asAccount(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)

  headers.set("authorization", `Bearer ${PLACEHOLDER}`)

  return new Request(url, { ...init, headers })
}

/** A JSON request made as the signed-in account. */
export function accountJson(method: string, url: string, body?: unknown): Request {
  return asAccount(url, {
    method,
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  })
}

/**
 * Asks `request` until `found` holds of its answer, for a live API that indexes what was just
 * made a moment later (search, mail delivery). Unrecorded; the scenario then records one call.
 */
export async function untilFound(
  target: Target,
  request: () => Request,
  found: (body: Json) => boolean,
): Promise<void> {
  const attempts = target.kind === "live" ? 20 : 1

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (found(await readJson(await target.send(request()))) || attempt === attempts) return
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

/** What a refresh needs: the client and the account's refresh token. */
interface AccountGrant {
  readonly clientId: string
  readonly clientSecret: string
  readonly refreshToken: string
}

/** Exchanges the refresh token for an access token. */
async function accessToken(
  app: AccountApp,
  tenant: string,
  grant: AccountGrant,
  send: (request: Request) => Promise<Response>,
): Promise<string> {
  const response = await send(
    new Request(app.tokenUrl(tenant), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken,
        client_id: grant.clientId,
        client_secret: grant.clientSecret,
      }),
    }),
  )
  const body: unknown = await response.json().catch(() => ({}))
  const token =
    typeof body === "object" && body !== null ? Reflect.get(body, "access_token") : undefined

  if (!response.ok || typeof token !== "string")
    throw new Error(
      `${app.label} refused the refresh token (${response.status}); sign in again with \`danwo fidelity login ${app.provider}\``,
    )

  return token
}

/** The account's address, read with `token`. */
async function emailOf(
  app: AccountApp,
  token: string,
  send: (request: Request) => Promise<Response>,
): Promise<string> {
  const response = await send(
    new Request(app.whoAmI, { headers: { authorization: `Bearer ${token}` } }),
  )
  const email = app.emailOf(await response.json().catch(() => ({})))

  if (email === undefined)
    throw new Error(`could not read which ${app.label} account the token is for`)

  return email
}

/** A send that puts the account's token into requests marked with {@link asAccount}. */
function signingSend(
  send: (request: Request) => Promise<Response>,
  token: () => Promise<string>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.headers.get("authorization") !== `Bearer ${PLACEHOLDER}`) return send(request)

    const signed = new Request(request, { headers: new Headers(request.headers) })

    signed.headers.set("authorization", `Bearer ${await token()}`)

    return send(signed)
  }
}

/** Runs `get` once, the first time its result is wanted. */
function once<T>(get: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined

  return () => (pending ??= get())
}

/**
 * The provider's own API, as the account the refresh token belongs to. The account is checked
 * against `env` before its token is used: see {@link checkAccount}.
 */
function liveAccountTarget(
  app: AccountApp,
  grant: AccountGrant,
  env: Readonly<Record<string, string | undefined>>,
): Target {
  const tenant = tenantOf(app, env)
  const token = once(async () => {
    const access = await accessToken(app, tenant, grant, sendLive)

    checkAccount(app, await emailOf(app, access, sendLive), env)

    return access
  })

  return { kind: "live", credentials: { [SIGNED_IN]: "live" }, send: signingSend(sendLive, token) }
}

/**
 * The live target for an account provider: as the signed-in test account when its client and
 * refresh token are set, else keyless for the public endpoints when those are allowed, else none.
 */
export function accountOrPublicTarget(
  app: AccountApp,
  env: Readonly<Record<string, string | undefined>>,
): Target | undefined {
  const value = (name: string) => env[name]?.trim() ?? ""
  const grant = {
    clientId: value(app.variables.clientId),
    clientSecret: value(app.variables.clientSecret),
    refreshToken: value(app.variables.refreshToken),
  }

  if (grant.clientId !== "" && grant.clientSecret !== "" && grant.refreshToken !== "")
    return liveAccountTarget(app, grant, env)

  return publicEndpointsAllowed(env) ? { kind: "live", credentials: {}, send: sendLive } : undefined
}

/** The emulator's account chooser, played as a person picking `email`: the URL it redirects to. */
export async function chooseAccount(
  send: (request: Request) => Promise<Response>,
  consentUrl: string,
  email: string,
): Promise<string> {
  const page = await (await send(new Request(consentUrl))).text()
  const action = /<form method="post" action="([^"]+)"/.exec(page)?.[1]
  const request = /name="request" value="([^"]+)"/.exec(page)?.[1]
  const user = /name="user" value="([^"]+)"/.exec(
    page.split("<li>").find((item) => item.includes(email)) ?? "",
  )?.[1]

  if (action === undefined || request === undefined || user === undefined)
    throw new Error(`the consent page offered no account ${email}`)

  const back = await send(
    new Request(new URL(action, consentUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, user }),
    }),
  )

  return back.headers.get("location") ?? ""
}

/** What an emulated account target is made from. */
export interface EmulatedAccount {
  readonly definition: EmulatorDefinition
  /** Loads the account and its OAuth client into a fresh emulator. */
  readonly seed: (
    emulator: Emulator,
    client: { id: string; secret: string; redirect: string },
  ) => void
  readonly email: string
}

const EMULATED_CLIENT = {
  id: "danwo-fidelity-client",
  secret: "danwo-fidelity-secret",
  redirect: "http://127.0.0.1:8765/callback",
}

/** Signs the seeded account in on the emulator's own consent page, for its refresh token. */
async function emulatedRefreshToken(
  app: AccountApp,
  emulator: Emulator,
  email: string,
): Promise<string> {
  const send = (request: Request) => emulator.fetch(request)
  const consent = new URL(app.authorizeUrl("common"))

  for (const [key, value] of Object.entries({
    client_id: EMULATED_CLIENT.id,
    redirect_uri: EMULATED_CLIENT.redirect,
    response_type: "code",
    scope: app.scopes.join(" "),
    ...app.offlineParams,
  }))
    consent.searchParams.set(key, value)

  const code =
    new URL(await chooseAccount(send, consent.href, email)).searchParams.get("code") ?? ""
  const answer = await send(
    new Request(app.tokenUrl("common"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: EMULATED_CLIENT.redirect,
        client_id: EMULATED_CLIENT.id,
        client_secret: EMULATED_CLIENT.secret,
      }),
    }),
  )
  const body: unknown = await answer.json()
  const refresh =
    typeof body === "object" && body !== null ? Reflect.get(body, "refresh_token") : undefined

  if (typeof refresh !== "string") throw new Error(`the emulator gave ${email} no refresh token`)

  return refresh
}

/** A fresh emulator with one signed-in account, reached the same way as the provider. */
export function emulatedAccountTarget(
  app: AccountApp,
  account: EmulatedAccount,
): Promise<OpenTarget> {
  const emulator = createEmulator(account.definition)
  const send = (request: Request) => emulator.fetch(request)

  account.seed(emulator, EMULATED_CLIENT)

  const token = once(async () =>
    accessToken(
      app,
      "common",
      {
        clientId: EMULATED_CLIENT.id,
        clientSecret: EMULATED_CLIENT.secret,
        refreshToken: await emulatedRefreshToken(app, emulator, account.email),
      },
      send,
    ),
  )

  return Promise.resolve({
    kind: "emulator",
    credentials: { [SIGNED_IN]: "emulated" },
    send: signingSend(send, token),
    close: () => emulator.close(),
  })
}

/** Stops a scenario that needs an account on a target that has none. */
export function requireAccount(
  context: Pick<ScenarioContext, "target" | "skip">,
  app: AccountApp,
): void {
  if (context.target.credentials[SIGNED_IN] === undefined)
    context.skip(`needs a ${app.label} test account: run \`danwo fidelity login ${app.provider}\``)
}
