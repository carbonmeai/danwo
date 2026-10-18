import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import type { Auth0RouteContext, Upstream } from "../context.ts"
import type {
  Auth0ConnectionRecord,
  Auth0TenantRecord,
  Auth0TransactionRecord,
} from "../entities.ts"
import { finishLogin } from "../flow.ts"
import { requestHost, requireTenant } from "../helpers.ts"
import { renderError } from "../pages.ts"
import { insertUser } from "../users.ts"

/** Where each social connection sends the browser, and where the tenant reads the profile. */
interface SocialProvider {
  readonly authorize: string
  readonly token: string
  readonly profile: string
  readonly scope: string
}

const PROVIDERS: Readonly<Record<string, SocialProvider>> = {
  "google-oauth2": {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    profile: "https://api.github.com/user",
    scope: "user:email",
  },
  windowslive: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    profile: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid email profile",
  },
}

/** A social profile reduced to what the tenant keeps: the upstream id, email and name. */
interface SocialProfile {
  readonly id: string
  readonly email: string
  readonly name: string
}

const field = (record: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = record[name]

    if (typeof value === "string" || typeof value === "number") return String(value)
  }

  return ""
}

/** Exchanges the upstream code, then reads who signed in there. */
async function fetchProfile(
  upstream: Upstream,
  provider: SocialProvider,
  connection: Auth0ConnectionRecord,
  code: string,
  redirectUri: string,
): Promise<SocialProfile | undefined> {
  const exchange = await upstream(
    new Request(provider.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: connection.client_id,
        client_secret: connection.client_secret,
      }),
    }),
  )
  const token = field(asRecord(await exchange.json()) ?? {}, "access_token")

  if (!exchange.ok || token === "") return undefined

  const me = await upstream(
    new Request(provider.profile, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    }),
  )
  const profile = asRecord(await me.json()) ?? {}
  const id = field(profile, "sub", "id")

  return me.ok && id !== ""
    ? { id, email: field(profile, "email"), name: field(profile, "name", "login") }
    : undefined
}

function connectionOf(context: Auth0RouteContext, tenant: Auth0TenantRecord, name: string) {
  return context
    .auth0()
    .connections.findBy("tenant", tenant.domain)
    .find((connection) => connection.name === name)
}

/** The user a social login maps to: found by that identity, or created on first login. */
function socialUser(
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  connection: string,
  profile: SocialProfile,
) {
  const auth0 = context.auth0()
  const userId = `${connection}|${profile.id}`

  return (
    auth0.users.findBy("user_id", userId).find((found) => found.tenant === tenant.domain) ??
    insertUser(auth0, tenant.domain, {
      email: profile.email || `${profile.id}@${connection}.invalid`,
      name: profile.name || profile.email,
      user_id: userId,
      connection,
    })
  )
}

const failed = (c: Context, message: string) => c.html(renderError("access_denied", message), 400)

async function callback(
  c: Context,
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  txn: Auth0TransactionRecord,
) {
  const connection = connectionOf(context, tenant, txn.method)
  const provider = PROVIDERS[txn.method]
  const upstream = context.upstream()

  if (!connection || !provider) return failed(c, `Unknown connection: ${txn.method}`)
  if (!upstream) return failed(c, "The social provider can't be reached from this tenant.")
  if (c.req.query("error") !== undefined)
    return failed(c, c.req.query("error_description") ?? "The social login was cancelled.")

  const profile = await fetchProfile(
    upstream,
    provider,
    connection,
    c.req.query("code") ?? "",
    `https://${requestHost(c)}/login/callback`,
  )

  if (!profile) return failed(c, "The social provider refused the login.")

  const user = socialUser(context, tenant, connection.name, profile)

  if (user.blocked) return failed(c, "user is blocked")

  return finishLogin(c, {
    auth0: context.auth0(),
    clock: context.clock,
    tenant,
    txn,
    user,
    mfa: false,
  })
}

/** Social logins: the button sends the browser to the provider, whose callback lands back here. */
export function socialRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/authorize/social", (c) => {
    const auth0 = context.auth0()
    const tenant = requireTenant(c, auth0)
    const txn = auth0.transactions.findOneBy("txn", c.req.query("state") ?? "")
    const name = c.req.query("connection") ?? ""
    const connection = connectionOf(context, tenant, name)
    const provider = PROVIDERS[name]

    if (!txn || txn.tenant !== tenant.domain || !connection || !provider)
      return failed(c, "The login could not start.")

    auth0.transactions.update(txn.id, { method: name })

    const target = new URL(provider.authorize)

    target.search = new URLSearchParams({
      client_id: connection.client_id,
      redirect_uri: `https://${requestHost(c)}/login/callback`,
      response_type: "code",
      scope: provider.scope,
      state: txn.txn,
    }).toString()

    return c.redirect(target.toString(), 302)
  })

  app.get("/login/callback", async (c) => {
    const auth0 = context.auth0()
    const tenant = requireTenant(c, auth0)
    const txn = auth0.transactions.findOneBy("txn", c.req.query("state") ?? "")

    return txn && txn.tenant === tenant.domain
      ? callback(c, context, tenant, txn)
      : failed(c, "The login session has expired.")
  })
}
