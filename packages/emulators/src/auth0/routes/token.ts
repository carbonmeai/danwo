import { createHash, timingSafeEqual } from "node:crypto"

import type { Context } from "../../http.ts"
import { clientCredentials, sameSecret } from "../../oauth/tokens.ts"
import type { Auth0RouteContext } from "../context.ts"
import type {
  Auth0ClientRecord,
  Auth0CodeRecord,
  Auth0RefreshRecord,
  Auth0TenantRecord,
} from "../entities.ts"
import {
  checkPassword,
  issuerOf,
  oauthError,
  requestFields,
  requestHost,
  requireTenant,
  scopesOf,
} from "../helpers.ts"
import {
  apiFor,
  GrantRefused,
  issueUserTokens,
  machineToken,
  newRefreshToken,
  type UserGrant,
} from "../issue.ts"

/** A grant's context: the routes' context plus the host the app called, which names the issuer. */
type GrantContext = Auth0RouteContext & { readonly host: string }

/** Clients with a secret must present it; public ones (SPAs, native apps) may not have one. */
const CONFIDENTIAL = new Set(["regular_web", "non_interactive"])

function authenticate(
  c: Context,
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  fields: Record<string, string>,
) {
  const { clientId, secret } = clientCredentials(c, fields)
  const client = context
    .auth0()
    .clients.findBy("client_id", clientId)
    .find((found) => found.tenant === tenant.domain)

  if (!client) throw new GrantRefused("access_denied", "Unauthorized")
  if (secret === "" && CONFIDENTIAL.has(client.app_type))
    throw new GrantRefused("access_denied", "Unauthorized")
  if (secret !== "" && !sameSecret(secret, client.client_secret))
    throw new GrantRefused("access_denied", "Unauthorized")

  return client
}

function allowGrant(client: Auth0ClientRecord, grant: string): void {
  if (!client.grant_types.includes(grant))
    throw new GrantRefused(
      "unauthorized_client",
      `Grant type '${grant}' not allowed for the client.`,
    )
}

function verifies(code: Auth0CodeRecord, verifier: string | undefined): boolean {
  const { code_challenge: challenge, code_challenge_method: method } = code.params

  if (challenge === null) return true
  if (!verifier) return false

  const expected = Buffer.from(
    method === "S256" ? createHash("sha256").update(verifier).digest("base64url") : verifier,
  )
  const given = Buffer.from(challenge)

  return expected.length === given.length && timingSafeEqual(expected, given)
}

function grantFor(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  from: Pick<Auth0RefreshRecord, "user_id" | "scope" | "audience" | "organization" | "sid"> & {
    nonce?: string | null
    authTime?: number
  },
): UserGrant {
  const user = context
    .auth0()
    .users.findBy("user_id", from.user_id)
    .find((found) => found.tenant === tenant.domain)

  if (!user || user.blocked) throw new GrantRefused("invalid_grant", "user is blocked")

  return {
    tenant,
    issuer: issuerOf(context.host),
    client,
    user,
    scope: from.scope,
    audience: from.audience,
    organization: from.organization,
    nonce: from.nonce ?? null,
    authTime: from.authTime ?? Math.floor(context.clock().getTime() / 1000),
    sid: from.sid,
  }
}

/** The unused, unexpired code `value` names for this client, bound to its redirect and PKCE challenge. */
function redeemableCode(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  fields: Record<string, string>,
) {
  const code = context.auth0().codes.findOneBy("code", fields.code ?? "")
  const live = (found: Auth0CodeRecord) =>
    !found.used &&
    found.tenant === tenant.domain &&
    found.params.client_id === client.client_id &&
    Date.parse(found.expiresAt) > context.clock().getTime()

  if (!code || !live(code)) throw new GrantRefused("invalid_grant", "Invalid authorization code")
  if (fields.redirect_uri !== undefined && fields.redirect_uri !== code.params.redirect_uri)
    throw new GrantRefused("invalid_grant", "Redirect URI mismatch")
  if (!verifies(code, fields.code_verifier))
    throw new GrantRefused("invalid_grant", "Failed PKCE verification")

  return code
}

function exchangeCode(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  fields: Record<string, string>,
) {
  const auth0 = context.auth0()
  const code = redeemableCode(context, tenant, client, fields)

  auth0.codes.update(code.id, { used: true })

  const grant = grantFor(context, tenant, client, {
    ...code.params,
    user_id: code.user_id,
    sid: code.sid,
    authTime: code.authTime,
  })

  return issueUserTokens({ auth0, key: context.key, clock: context.clock }, grant, () =>
    client.grant_types.includes("refresh_token") ? newRefreshToken(auth0, grant) : undefined,
  )
}

/** Whether a rotated-out refresh token is still inside its reuse leeway. */
function withinLeeway(record: Auth0RefreshRecord, client: Auth0ClientRecord, now: number): boolean {
  return (
    record.rotatedAt !== null &&
    now - Date.parse(record.rotatedAt) < client.reuseLeewaySeconds * 1000
  )
}

/**
 * The live refresh token `value` names for this client. Reusing one already rotated out, past
 * the leeway, revokes its whole family: Auth0's answer to a leaked token.
 */
function usableRefreshToken(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  value: string,
): Auth0RefreshRecord {
  const auth0 = context.auth0()
  const record = auth0.refreshTokens.findOneBy("token", value)
  const unknown = new GrantRefused("invalid_grant", "Unknown or invalid refresh token.")

  if (
    !record ||
    record.revoked ||
    record.client_id !== client.client_id ||
    record.tenant !== tenant.domain
  )
    throw unknown

  if (record.rotatedAt !== null && !withinLeeway(record, client, context.clock().getTime())) {
    for (const member of auth0.refreshTokens.findBy("family", record.family))
      auth0.refreshTokens.update(member.id, { revoked: true })

    throw unknown
  }

  return record
}

/** The scopes a refresh asks for, kept to those originally granted; all of them when none are asked. */
function narrowedScope(asked: string | undefined, granted: string): string {
  if (!asked) return granted

  return scopesOf(asked)
    .filter((scope) => scopesOf(granted).includes(scope))
    .join(" ")
}

function refreshTokens(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  fields: Record<string, string>,
) {
  const auth0 = context.auth0()
  const record = usableRefreshToken(context, tenant, client, fields.refresh_token ?? "")
  const grant = grantFor(context, tenant, client, {
    ...record,
    scope: narrowedScope(fields.scope, record.scope),
  })
  const rotating = client.rotation === "rotating"

  if (rotating) auth0.refreshTokens.update(record.id, { rotatedAt: context.clock().toISOString() })

  return issueUserTokens({ auth0, key: context.key, clock: context.clock }, grant, () =>
    rotating ? newRefreshToken(auth0, { ...grant, scope: record.scope }, record.family) : undefined,
  )
}

function clientCredentialsGrant(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  fields: Record<string, string>,
) {
  const audience = fields.audience ?? ""
  const api = apiFor(context.auth0(), tenant.domain, audience)
  const grant = context
    .auth0()
    .clientGrants.findBy("client_id", client.client_id)
    .find((found) => found.tenant === tenant.domain && found.audience === audience)

  if (!grant)
    throw new GrantRefused(
      "access_denied",
      `Client is not authorized to access "${audience}". You need to create a "client-grant" associated to this API.`,
    )

  const asked = scopesOf(fields.scope)
  const scopes =
    asked.length === 0 ? grant.scope : asked.filter((scope) => grant.scope.includes(scope))

  return machineToken(
    { key: context.key, clock: context.clock },
    { issuer: issuerOf(context.host), client, api, scopes },
  )
}

function passwordGrant(
  context: GrantContext,
  tenant: Auth0TenantRecord,
  client: Auth0ClientRecord,
  fields: Record<string, string>,
) {
  const auth0 = context.auth0()
  const user = auth0.users
    .findBy("email", (fields.username ?? "").toLowerCase())
    .find((found) => found.tenant === tenant.domain)

  if (!user || !checkPassword(fields.password ?? "", user.passwordHash))
    throw new GrantRefused("invalid_grant", "Wrong email or password.")
  if (user.blocked) throw new GrantRefused("unauthorized", "user is blocked")
  if (user.mfaSecret !== null)
    throw new GrantRefused("mfa_required", "Multifactor authentication required")

  const grant = grantFor(context, tenant, client, {
    user_id: user.user_id,
    scope: fields.scope ?? "openid",
    audience: fields.audience ?? null,
    organization: null,
    sid: "",
  })

  return issueUserTokens({ auth0, key: context.key, clock: context.clock }, grant, () =>
    client.grant_types.includes("refresh_token") ? newRefreshToken(auth0, grant) : undefined,
  )
}

const GRANTS: Readonly<Record<string, typeof exchangeCode>> = {
  authorization_code: exchangeCode,
  refresh_token: refreshTokens,
  client_credentials: clientCredentialsGrant,
  password: passwordGrant,
  "http://auth0.com/oauth/grant-type/password-realm": passwordGrant,
}

/** `/oauth/token`: codes, refresh tokens (rotated or not), client credentials and passwords. */
export function tokenRoutes(context: Auth0RouteContext): void {
  context.app.post("/oauth/token", async (c) => {
    const tenant = requireTenant(c, context.auth0())
    const fields = await requestFields(c)
    const type = fields.grant_type ?? ""
    const handler = GRANTS[type]

    if (!handler)
      return oauthError(c, 400, "unsupported_grant_type", `Unsupported grant type: ${type}`)

    try {
      const client = authenticate(c, context, tenant, fields)

      allowGrant(
        client,
        type === "http://auth0.com/oauth/grant-type/password-realm" ? "password" : type,
      )

      return c.json(handler({ ...context, host: requestHost(c) }, tenant, client, fields), 200, {
        "cache-control": "no-store",
      })
    } catch (error) {
      if (!(error instanceof GrantRefused)) throw error

      return oauthError(
        c,
        error.error === "access_denied" ? 401 : 403,
        error.error,
        error.description,
      )
    }
  })
}
