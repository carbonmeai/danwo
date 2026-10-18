import type { Entity } from "../store.ts"

/** A tenant: its canonical domain, any custom domains, and the claims its post-login step adds. */
export interface Auth0TenantRecord extends Entity {
  /** The canonical domain, such as `acme.us.auth0.com`. */
  domain: string
  /** Custom domains that answer for the tenant, such as `login.acme.test`. */
  aliases: string[]
  /** Shown on the login page: "Log in to <friendlyName> to continue to <app>". */
  friendlyName: string
  /** Added to every ID token and access token issued after a login, as a post-login Action would. */
  postLoginClaims: Record<string, unknown>
  /** When set, the user's role names are added under this claim name. */
  rolesClaim: string | null
  /** Refuse logins of users whose email is not verified, as many tenants' Actions do. */
  requireVerifiedEmail: boolean
}

/** How a client is meant to be used; decides which grants it may use by default. */
export type Auth0AppType = "regular_web" | "spa" | "native" | "non_interactive"

/** An application registered on a tenant. */
export interface Auth0ClientRecord extends Entity {
  tenant: string
  client_id: string
  client_secret: string
  name: string
  app_type: Auth0AppType
  callbacks: string[]
  allowed_logout_urls: string[]
  grant_types: string[]
  /** `rotating` hands out a new refresh token on every use and refuses a reused one. */
  rotation: "rotating" | "non-rotating"
  /** Seconds a rotated refresh token may still be used again before reuse counts as theft. */
  reuseLeewaySeconds: number
}

/** An API (a resource server) access tokens can be issued for. */
export interface Auth0ApiRecord extends Entity {
  tenant: string
  /** The audience apps ask for. */
  identifier: string
  name: string
  scopes: string[]
  /** RBAC: users only get the scopes their roles grant. */
  enforcePolicies: boolean
  /** Add the user's permissions to the access token as `permissions`. */
  permissionsInToken: boolean
  allowOfflineAccess: boolean
  tokenLifetimeSeconds: number
}

/** Which scopes of which API a machine-to-machine client may request. */
export interface Auth0ClientGrantRecord extends Entity {
  grantId: string
  tenant: string
  client_id: string
  audience: string
  scope: string[]
}

/** A social login a tenant offers, such as Google through `google-oauth2`. */
export interface Auth0ConnectionRecord extends Entity {
  tenant: string
  /** The connection name, which is also its strategy: `google-oauth2`, `github`, `windowslive`. */
  name: string
  /** The client id and secret the tenant uses at the upstream provider. */
  client_id: string
  client_secret: string
}

/** One of a user's identities, as the Management API lists them. */
export interface Auth0Identity {
  connection: string
  provider: string
  user_id: string
  isSocial: boolean
}

/** A user of a tenant. */
export interface Auth0UserRecord extends Entity {
  tenant: string
  user_id: string
  email: string
  email_verified: boolean
  /** `salt:hash`, or null for users who only sign in through a social connection. */
  passwordHash: string | null
  name: string
  nickname: string
  given_name: string | null
  family_name: string | null
  picture: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
  blocked: boolean
  /** A base32 TOTP secret when the user has enrolled an authenticator app. */
  mfaSecret: string | null
  identities: Auth0Identity[]
  /** Extra claims for this user's tokens, on top of the tenant's post-login claims. */
  claims: Record<string, unknown>
  logins_count: number
  last_login: string | null
}

/** A permission a role grants on an API. */
export interface Auth0Permission {
  resource_server_identifier: string
  permission_name: string
}

export interface Auth0RoleRecord extends Entity {
  tenant: string
  roleId: string
  name: string
  description: string
  permissions: Auth0Permission[]
}

export interface Auth0UserRoleRecord extends Entity {
  tenant: string
  user_id: string
  roleId: string
}

export interface Auth0OrganizationRecord extends Entity {
  tenant: string
  orgId: string
  name: string
  display_name: string
  members: string[]
}

/** What an authorization request asked for, kept while the user logs in. */
export interface Auth0AuthorizeParams {
  client_id: string
  redirect_uri: string
  response_type: string
  response_mode: "query" | "fragment" | "form_post"
  scope: string
  state: string | null
  nonce: string | null
  audience: string | null
  organization: string | null
  code_challenge: string | null
  code_challenge_method: "plain" | "S256" | null
}

/** A login in progress, from `/authorize` until the browser goes back to the app. */
export interface Auth0TransactionRecord extends Entity {
  /** The opaque `state` the login pages carry. */
  txn: string
  tenant: string
  params: Auth0AuthorizeParams
  /** Set once the password (or social login) checked out and only the second factor is left. */
  pendingUser: string | null
  /** How the user got past the first factor: `password`, `signup` or a connection name. */
  method: string
}

/** A one-time authorization code. */
export interface Auth0CodeRecord extends Entity {
  code: string
  tenant: string
  params: Auth0AuthorizeParams
  user_id: string
  authTime: number
  sid: string
  expiresAt: string
  used: boolean
}

/** A browser's login session on a tenant, which lets `prompt=none` sign in without a page. */
export interface Auth0SessionRecord extends Entity {
  sid: string
  tenant: string
  user_id: string
  authTime: number
  ended: boolean
}

/** A refresh token; rotated ones keep their family so a stolen one can revoke the lot. */
export interface Auth0RefreshRecord extends Entity {
  token: string
  tenant: string
  client_id: string
  user_id: string
  audience: string | null
  scope: string
  organization: string | null
  sid: string
  family: string
  /** When it was rotated out; using it again after the leeway revokes the family. */
  rotatedAt: string | null
  revoked: boolean
}

/** An opaque access token, issued when no API audience was asked for; good for `/userinfo` only. */
export interface Auth0OpaqueTokenRecord extends Entity {
  token: string
  tenant: string
  client_id: string
  user_id: string
  scope: string
  expiresAt: string
}

/** One login, as the inspection helper reports it. */
export interface Auth0LoginRecord extends Entity {
  tenant: string
  user_id: string
  client_id: string
  /** `password`, `signup`, `silent` (`prompt=none`) or a connection name for social logins. */
  method: string
  mfa: boolean
}

/** An email the tenant sent, such as a verification email from `/api/v2/jobs/verification-email`. */
export interface Auth0EmailRecord extends Entity {
  tenant: string
  to: string
  kind: "verify_email"
  /** The link in the email; opening it verifies the address. */
  link: string
  ticket: string
  used: boolean
}

/** A job the Management API started; the emulator finishes them at once. */
export interface Auth0JobRecord extends Entity {
  jobId: string
  tenant: string
  type: string
  user_id: string
}
