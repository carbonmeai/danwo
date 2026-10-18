import type { Context } from "../../http.ts"
import { clientCredentials, sameSecret } from "../../oauth/tokens.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0ClientRecord, Auth0TenantRecord } from "../entities.ts"
import { SESSION_COOKIE, sessionCookie } from "../flow.ts"
import { oauthError, requestFields, requireTenant, urlAllowed } from "../helpers.ts"
import { renderError } from "../pages.ts"
import { verifiedClaims } from "../verify.ts"

const CLEARED = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`

function clientOn(
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  clientId: string | undefined,
) {
  if (clientId === undefined) return undefined

  return context
    .auth0()
    .clients.findBy("client_id", clientId)
    .find((found) => found.tenant === tenant.domain)
}

/** Ends the browser's session on the tenant and its refresh tokens' session ties. */
function endSession(c: Context, context: Auth0RouteContext): void {
  const auth0 = context.auth0()
  const sid = sessionCookie(c)
  const session = sid === undefined ? undefined : auth0.sessions.findOneBy("sid", sid)

  if (session) auth0.sessions.update(session.id, { ended: true })
}

/** Where a logout sends the browser: `returnTo` when the client allows it, or a page saying it's done. */
function afterLogout(
  c: Context,
  client: Auth0ClientRecord | undefined,
  returnTo: string | undefined,
  state?: string,
) {
  if (returnTo === undefined)
    return c.html(renderError("Logged out", "You have been logged out."), 200, {
      "set-cookie": CLEARED,
    })

  if (!client || !urlAllowed(returnTo, client.allowed_logout_urls))
    return c.html(
      renderError(
        "invalid_request",
        `The "returnTo" querystring parameter "${returnTo}" is not defined as a valid URL in "Allowed Logout URLs".`,
      ),
      400,
    )

  const target = new URL(returnTo)

  if (state !== undefined) target.searchParams.set("state", state)

  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "set-cookie": CLEARED },
  })
}

function logoutRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/v2/logout", (c) => {
    const tenant = requireTenant(c, context.auth0())

    endSession(c, context)

    return afterLogout(
      c,
      clientOn(context, tenant, c.req.query("client_id")),
      c.req.query("returnTo"),
    )
  })

  app.get("/oidc/logout", (c) => {
    const tenant = requireTenant(c, context.auth0())
    const hint = c.req.query("id_token_hint")
    const claims =
      hint === undefined ? undefined : verifiedClaims(context.key, hint, () => new Date(0))
    const clientId =
      c.req.query("client_id") ?? (typeof claims?.aud === "string" ? claims.aud : undefined)

    endSession(c, context)

    return afterLogout(
      c,
      clientOn(context, tenant, clientId),
      c.req.query("post_logout_redirect_uri"),
      c.req.query("state"),
    )
  })
}

/** `/oauth/revoke`: revokes a refresh token and the rest of its rotation family. */
function revokeRoutes(context: Auth0RouteContext): void {
  context.app.post("/oauth/revoke", async (c) => {
    const auth0 = context.auth0()
    const tenant = requireTenant(c, auth0)
    const fields = await requestFields(c)
    const { clientId, secret } = clientCredentials(c, fields)
    const client = clientOn(context, tenant, clientId)

    if (!client || (secret !== "" && !sameSecret(secret, client.client_secret)))
      return oauthError(c, 401, "access_denied", "Unauthorized")

    const record = auth0.refreshTokens.findOneBy("token", fields.token ?? "")

    if (record && record.client_id === client.client_id)
      for (const member of auth0.refreshTokens.findBy("family", record.family))
        auth0.refreshTokens.update(member.id, { revoked: true })

    return c.body(null, 200)
  })
}

/** Logout (`/v2/logout`, `/oidc/logout`) and refresh-token revocation. */
export function sessionRoutes(context: Auth0RouteContext): void {
  for (const register of [logoutRoutes, revokeRoutes]) register(context)
}
