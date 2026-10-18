import type { Context } from "../../http.ts"
import { bearerToken } from "../../oauth/tokens.ts"
import { profileClaims } from "../claims.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0TenantRecord, Auth0UserRecord } from "../entities.ts"
import { issuerOf, requireTenant, requestHost, scopesOf } from "../helpers.ts"
import { hasAudience, verifiedClaims } from "../verify.ts"

/** The tenant's OpenID Provider metadata, with every endpoint on the host the app asked. */
function discovery(host: string) {
  const base = `https://${host}`

  return {
    issuer: issuerOf(host),
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    device_authorization_endpoint: `${base}/oauth/device/code`,
    userinfo_endpoint: `${base}/userinfo`,
    mfa_challenge_endpoint: `${base}/mfa/challenge`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    registration_endpoint: `${base}/oidc/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    end_session_endpoint: `${base}/oidc/logout`,
    scopes_supported: [
      "openid",
      "profile",
      "offline_access",
      "name",
      "given_name",
      "family_name",
      "nickname",
      "email",
      "email_verified",
      "picture",
      "created_at",
      "identities",
      "phone",
      "address",
    ],
    response_types_supported: [
      "code",
      "token",
      "id_token",
      "code token",
      "code id_token",
      "token id_token",
      "code token id_token",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
    response_modes_supported: ["query", "fragment", "form_post"],
    subject_types_supported: ["public"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "private_key_jwt",
    ],
    claims_supported: [
      "aud",
      "auth_time",
      "created_at",
      "email",
      "email_verified",
      "exp",
      "family_name",
      "given_name",
      "iat",
      "identities",
      "iss",
      "name",
      "nickname",
      "phone_number",
      "picture",
      "sub",
    ],
    request_uri_parameter_supported: false,
    request_parameter_supported: false,
    id_token_signing_alg_values_supported: ["HS256", "RS256", "PS256"],
    end_session_endpoint_supported: true,
  }
}

/** The user and scopes an access token stands for, whichever kind of token it is. */
function holderOf(
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  host: string,
  token: string,
) {
  const auth0 = context.auth0()
  const opaqueToken = auth0.opaqueTokens.findOneBy("token", token)

  if (opaqueToken) {
    const live =
      opaqueToken.tenant === tenant.domain &&
      Date.parse(opaqueToken.expiresAt) > context.clock().getTime()

    return live ? { userId: opaqueToken.user_id, scopes: scopesOf(opaqueToken.scope) } : undefined
  }

  const claims = verifiedClaims(context.key, token, context.clock)

  if (!claims || !hasAudience(claims, `${issuerOf(host)}userinfo`)) return undefined

  return {
    userId: String(claims.sub),
    scopes: scopesOf(typeof claims.scope === "string" ? claims.scope : ""),
  }
}

function userinfo(user: Auth0UserRecord, scopes: readonly string[]) {
  return { sub: user.user_id, ...profileClaims(user, scopes) }
}

function unauthorized(c: Context) {
  return c.text("Unauthorized", 401, {
    "www-authenticate": 'Bearer realm="Auth0", error="invalid_token"',
  })
}

/** Discovery, the signing keys and `/userinfo`. */
export function discoveryRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/.well-known/openid-configuration", (c) => {
    requireTenant(c, context.auth0())

    return c.json(discovery(requestHost(c)))
  })

  app.get("/.well-known/jwks.json", (c) => {
    requireTenant(c, context.auth0())

    return c.json({ keys: [{ ...context.key.jwk, x5t: context.key.kid }] })
  })

  app.get("/userinfo", (c) => {
    const tenant = requireTenant(c, context.auth0())
    const token = bearerToken(c)
    const holder =
      token === undefined ? undefined : holderOf(context, tenant, requestHost(c), token)
    const user =
      holder &&
      context
        .auth0()
        .users.findBy("user_id", holder.userId)
        .find((found) => found.tenant === tenant.domain)

    return user && holder ? c.json(userinfo(user, holder.scopes)) : unauthorized(c)
  })
}
