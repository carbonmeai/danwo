import type { SigningKey } from "../oauth/jwt.ts"
import type { Clock } from "../store.ts"
import {
  apiScopes,
  organizationClaims,
  permissionsOn,
  postLoginClaims,
  profileClaims,
} from "./claims.ts"
import type {
  Auth0ApiRecord,
  Auth0ClientRecord,
  Auth0OrganizationRecord,
  Auth0TenantRecord,
  Auth0UserRecord,
} from "./entities.ts"
import { opaque, scopesOf } from "./helpers.ts"
import type { Auth0Store } from "./store.ts"

/** Seconds an ID token lives, as Auth0's default. */
const ID_TOKEN_SECONDS = 36_000

/** Seconds an opaque `/userinfo`-only access token lives. */
const OPAQUE_SECONDS = 86_400

/** Scopes that are about the sign-in itself rather than an API. */
const OIDC_SCOPES = new Set(["openid", "profile", "email", "address", "phone", "offline_access"])

/** Everything a user's tokens are issued from. */
export interface UserGrant {
  readonly tenant: Auth0TenantRecord
  /** The issuer the tokens name: the host the app called, canonical or custom domain. */
  readonly issuer: string
  readonly client: Auth0ClientRecord
  readonly user: Auth0UserRecord
  readonly scope: string
  readonly audience: string | null
  readonly organization: string | null
  readonly nonce: string | null
  readonly authTime: number
  readonly sid: string
}

/** What the token endpoint answers with. */
export interface TokenSet {
  readonly access_token: string
  readonly id_token?: string
  readonly refresh_token?: string
  readonly scope: string
  readonly expires_in: number
  readonly token_type: "Bearer"
}

/** Why tokens could not be issued for a grant. */
export class GrantRefused extends Error {
  readonly error: string
  readonly description: string

  constructor(error: string, description: string) {
    super(description)
    this.error = error
    this.description = description
  }
}

const seconds = (clock: Clock) => Math.floor(clock().getTime() / 1000)

/** The API an audience names on the grant's tenant, or a refusal for an unknown one. */
export function apiFor(auth0: Auth0Store, tenant: string, audience: string): Auth0ApiRecord {
  const api = auth0.apis.findBy("identifier", audience).find((found) => found.tenant === tenant)

  if (!api) throw new GrantRefused("access_denied", `Service not found: ${audience}`)

  return api
}

function organizationOf(auth0: Auth0Store, grant: UserGrant): Auth0OrganizationRecord | undefined {
  if (grant.organization === null) return undefined

  return auth0.organizations
    .all()
    .find((org) => org.tenant === grant.tenant.domain && org.orgId === grant.organization)
}

/** The scopes a user grant ends up with: the sign-in scopes asked for, plus what the API allows. */
function grantedScopes(auth0: Auth0Store, grant: UserGrant, api: Auth0ApiRecord | undefined) {
  const requested = scopesOf(grant.scope)
  const oidc = requested.filter((scope) => OIDC_SCOPES.has(scope))
  const offlineAllowed = api === undefined || api.allowOfflineAccess
  const signIn = oidc.filter((scope) => scope !== "offline_access" || offlineAllowed)

  return api ? [...signIn, ...apiScopes(auth0, grant.user, api, requested)] : signIn
}

/** The access token for an API: a signed JWT naming the user, the API and what they may do. */
function apiAccessToken(
  context: { auth0: Auth0Store; key: SigningKey; clock: Clock },
  grant: UserGrant,
  api: Auth0ApiRecord,
  scopes: readonly string[],
): string {
  const now = seconds(context.clock)
  const issuer = grant.issuer
  const audience = scopes.includes("openid")
    ? [api.identifier, `${issuer}userinfo`]
    : api.identifier

  return context.key.sign({
    ...postLoginClaims(context.auth0, grant.tenant, grant.user),
    iss: issuer,
    sub: grant.user.user_id,
    aud: audience,
    iat: now,
    exp: now + api.tokenLifetimeSeconds,
    scope: scopes.join(" "),
    azp: grant.client.client_id,
    ...(api.enforcePolicies &&
      api.permissionsInToken && {
        permissions: permissionsOn(context.auth0, grant.user, api.identifier),
      }),
    ...organizationClaims(organizationOf(context.auth0, grant)),
  })
}

/** The ID token: who signed in, for which app, with the profile the scopes allow. */
function idToken(
  context: { auth0: Auth0Store; key: SigningKey; clock: Clock },
  grant: UserGrant,
  scopes: readonly string[],
): string {
  const now = seconds(context.clock)

  return context.key.sign({
    ...postLoginClaims(context.auth0, grant.tenant, grant.user),
    ...profileClaims(grant.user, scopes),
    iss: grant.issuer,
    sub: grant.user.user_id,
    aud: grant.client.client_id,
    iat: now,
    exp: now + ID_TOKEN_SECONDS,
    auth_time: grant.authTime,
    sid: grant.sid,
    ...(grant.nonce !== null && { nonce: grant.nonce }),
    ...organizationClaims(organizationOf(context.auth0, grant)),
  })
}

/** An opaque access token, good only for `/userinfo`, for logins that asked for no API. */
function opaqueToken(auth0: Auth0Store, grant: UserGrant, scopes: readonly string[], clock: Clock) {
  return auth0.opaqueTokens.insert({
    token: opaque(32),
    tenant: grant.tenant.domain,
    client_id: grant.client.client_id,
    user_id: grant.user.user_id,
    scope: scopes.join(" "),
    expiresAt: new Date(clock().getTime() + OPAQUE_SECONDS * 1000).toISOString(),
  }).token
}

/** A refresh token in `family`; a new family when none is given. */
export function newRefreshToken(auth0: Auth0Store, grant: UserGrant, family?: string): string {
  return auth0.refreshTokens.insert({
    token: opaque(36),
    tenant: grant.tenant.domain,
    client_id: grant.client.client_id,
    user_id: grant.user.user_id,
    audience: grant.audience,
    scope: grant.scope,
    organization: grant.organization,
    sid: grant.sid,
    family: family ?? opaque(12),
    rotatedAt: null,
    revoked: false,
  }).token
}

/** Tokens for a user grant; `refresh` is the refresh token to hand back, if any. */
export function issueUserTokens(
  context: { auth0: Auth0Store; key: SigningKey; clock: Clock },
  grant: UserGrant,
  refresh: (scopes: readonly string[]) => string | undefined,
): TokenSet {
  const api =
    grant.audience === null ? undefined : apiFor(context.auth0, grant.tenant.domain, grant.audience)
  const scopes = grantedScopes(context.auth0, grant, api)
  const refreshToken = scopes.includes("offline_access") ? refresh(scopes) : undefined

  return {
    access_token: api
      ? apiAccessToken(context, grant, api, scopes)
      : opaqueToken(context.auth0, grant, scopes, context.clock),
    ...(scopes.includes("openid") && { id_token: idToken(context, grant, scopes) }),
    ...(refreshToken !== undefined && { refresh_token: refreshToken }),
    scope: scopes.join(" "),
    expires_in: api ? api.tokenLifetimeSeconds : OPAQUE_SECONDS,
    token_type: "Bearer",
  }
}

/** A machine-to-machine access token for an API, issued to a client by its client grant. */
export function machineToken(
  context: { key: SigningKey; clock: Clock },
  grant: {
    issuer: string
    client: Auth0ClientRecord
    api: Auth0ApiRecord
    scopes: readonly string[]
  },
): TokenSet {
  const now = seconds(context.clock)
  const lifetime = grant.api.tokenLifetimeSeconds

  return {
    access_token: context.key.sign({
      iss: grant.issuer,
      sub: `${grant.client.client_id}@clients`,
      aud: grant.api.identifier,
      iat: now,
      exp: now + lifetime,
      scope: grant.scopes.join(" "),
      gty: "client-credentials",
      azp: grant.client.client_id,
      ...(grant.api.enforcePolicies &&
        grant.api.permissionsInToken && { permissions: grant.scopes }),
    }),
    scope: grant.scopes.join(" "),
    expires_in: lifetime,
    token_type: "Bearer",
  }
}
