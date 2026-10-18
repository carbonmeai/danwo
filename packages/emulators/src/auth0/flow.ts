import type { Context } from "../http.ts"
import type { Clock } from "../store.ts"
import type {
  Auth0AuthorizeParams,
  Auth0ClientRecord,
  Auth0TenantRecord,
  Auth0TransactionRecord,
  Auth0UserRecord,
} from "./entities.ts"
import { opaque } from "./helpers.ts"
import { formPost } from "./pages.ts"
import type { Auth0Store } from "./store.ts"

/** The browser cookie that carries a tenant's login session. */
export const SESSION_COOKIE = "auth0"

const CODE_LIFETIME_MS = 10 * 60 * 1000

/** Sends the browser back to the app with `fields`, the way the request's response mode asks. */
export function backToApp(
  c: Context,
  params: Pick<Auth0AuthorizeParams, "redirect_uri" | "response_mode" | "state">,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Response {
  const all = params.state === null ? fields : { ...fields, state: params.state }

  if (params.response_mode === "form_post")
    return c.html(formPost(params.redirect_uri, all), 200, headers)

  const target = new URL(params.redirect_uri)
  const encoded = new URLSearchParams(all)

  if (params.response_mode === "fragment") target.hash = encoded.toString()
  else for (const [name, value] of encoded) target.searchParams.set(name, value)

  return new Response(null, { status: 302, headers: { location: target.toString(), ...headers } })
}

/** The session id in the request's tenant cookie, if any. */
export function sessionCookie(c: Context): string | undefined {
  const cookies = (c.req.header("cookie") ?? "").split(/;\s*/)
  const found = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))

  return found?.slice(SESSION_COOKIE.length + 1)
}

/** What finishing a login needs besides the request. */
export interface LoginFinish {
  readonly auth0: Auth0Store
  readonly clock: Clock
  readonly tenant: Auth0TenantRecord
  readonly txn: Auth0TransactionRecord
  readonly user: Auth0UserRecord
  readonly mfa: boolean
  /** An existing session to reuse (a `prompt=none` login) rather than starting one. */
  readonly sid?: string
}

/** A login the tenant refuses after the credentials checked out, as a post-login rule would. */
function refusal(tenant: Auth0TenantRecord, user: Auth0UserRecord): string | undefined {
  if (tenant.requireVerifiedEmail && !user.email_verified)
    return "Please verify your email before logging in."

  return undefined
}

function recordLogin(finish: LoginFinish, client: string, method: string): void {
  const { auth0, user, clock } = finish

  auth0.logins.insert({
    tenant: user.tenant,
    user_id: user.user_id,
    client_id: client,
    method,
    mfa: finish.mfa,
  })
  auth0.users.update(user.id, {
    logins_count: user.logins_count + 1,
    last_login: clock().toISOString(),
  })
}

/** A new login session, or the given one, and the time the user authenticated. */
function sessionFor(finish: LoginFinish): { sid: string; authTime: number } {
  const existing =
    finish.sid === undefined ? undefined : finish.auth0.sessions.findOneBy("sid", finish.sid)

  if (existing) return { sid: existing.sid, authTime: existing.authTime }

  const authTime = Math.floor(finish.clock().getTime() / 1000)
  const session = finish.auth0.sessions.insert({
    sid: opaque(16),
    tenant: finish.tenant.domain,
    user_id: finish.user.user_id,
    authTime,
    ended: false,
  })

  return { sid: session.sid, authTime }
}

/**
 * Ends a login: refused users go back to the app with `access_denied`; everyone else gets a code,
 * a session cookie on the tenant, and a login record.
 */
export function finishLogin(c: Context, finish: LoginFinish): Response {
  const { auth0, txn, user } = finish
  const { params } = txn

  auth0.transactions.delete(txn.id)

  const refused = refusal(finish.tenant, user)

  if (refused !== undefined)
    return backToApp(c, params, { error: "access_denied", error_description: refused })

  const { sid, authTime } = sessionFor(finish)
  const code = auth0.codes.insert({
    code: opaque(24),
    tenant: finish.tenant.domain,
    params,
    user_id: user.user_id,
    authTime,
    sid,
    expiresAt: new Date(finish.clock().getTime() + CODE_LIFETIME_MS).toISOString(),
    used: false,
  })

  recordLogin(finish, params.client_id, finish.sid === undefined ? txn.method : "silent")

  return backToApp(
    c,
    params,
    { code: code.code },
    {
      "set-cookie": `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=None`,
    },
  )
}

/** The application a transaction is for. */
export function clientOf(
  auth0: Auth0Store,
  txn: Auth0TransactionRecord,
): Auth0ClientRecord | undefined {
  return auth0.clients
    .findBy("client_id", txn.params.client_id)
    .find((client) => client.tenant === txn.tenant)
}
