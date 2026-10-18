import type { Store } from "../store.ts"
import type { Auth0AppType, Auth0Permission } from "./entities.ts"
import { hexId, managementAudience } from "./helpers.ts"
import { type Auth0Store, auth0Store } from "./store.ts"
import { insertUser, type NewUser } from "./users.ts"

/** The scopes Auth0's Management API v2 knows that the emulator's endpoints check. */
export const MANAGEMENT_SCOPES = [
  "read:users",
  "create:users",
  "update:users",
  "delete:users",
  "update:users_app_metadata",
  "read:roles",
  "create:roles",
  "update:roles",
  "delete:roles",
  "read:role_members",
  "create:role_members",
  "read:organizations",
  "create:organizations",
  "update:organizations",
  "delete:organizations",
  "read:organization_members",
  "create:organization_members",
  "delete:organization_members",
  "create:user_tickets",
]

/** An application on a tenant: a web app, SPA, native app or machine-to-machine client. */
export interface Auth0SeedClient {
  readonly client_id: string
  readonly client_secret?: string
  readonly name: string
  /** `regular_web` by default; `non_interactive` is a machine-to-machine client. */
  readonly app_type?: Auth0AppType
  readonly callbacks?: readonly string[]
  readonly allowed_logout_urls?: readonly string[]
  /** Defaults by app type; add `password` to allow the password grant. */
  readonly grant_types?: readonly string[]
  readonly refresh_token?: {
    readonly rotation?: "rotating" | "non-rotating"
    readonly leeway_seconds?: number
  }
  /** Management API scopes this client may get with client credentials. */
  readonly management_scopes?: readonly string[]
  /** Other APIs this client may call with client credentials, and with which scopes. */
  readonly client_grants?: readonly {
    readonly audience: string
    readonly scopes: readonly string[]
  }[]
}

/** An API (resource server) tokens can be issued for, by its identifier (the audience). */
export interface Auth0SeedApi {
  readonly identifier: string
  readonly name?: string
  readonly scopes?: readonly string[]
  /** RBAC: users only get the scopes their roles grant. */
  readonly rbac?: boolean
  /** Add the user's permissions to access tokens as `permissions` (needs `rbac`). */
  readonly permissions_in_token?: boolean
  readonly allow_offline_access?: boolean
  /** Seconds; 86400 by default. */
  readonly token_lifetime?: number
}

/** A user in the tenant's database connection, with their roles and organizations by name. */
export type Auth0SeedUser = NewUser & {
  /** Role names to give the user. */
  readonly roles?: readonly string[]
  /** Organization names the user is a member of. */
  readonly organizations?: readonly string[]
}

/** A role and the API permissions it grants. */
export interface Auth0SeedRole {
  readonly name: string
  readonly description?: string
  readonly permissions?: readonly Auth0Permission[]
}

/** A tenant: its domains, applications, APIs, roles, organizations, users and social logins. */
export interface Auth0SeedTenant {
  /** The canonical domain, such as `acme.us.auth0.com`. */
  readonly domain: string
  readonly custom_domains?: readonly string[]
  readonly friendly_name?: string
  /** Claims a post-login step adds to every token, e.g. `{ "https://app.example/plan": "pro" }`. */
  readonly post_login_claims?: Record<string, unknown>
  /** Add the user's role names under this (namespaced) claim. */
  readonly roles_claim?: string
  /** Refuse logins of users whose email is not verified. */
  readonly require_verified_email?: boolean
  readonly clients?: readonly Auth0SeedClient[]
  readonly apis?: readonly Auth0SeedApi[]
  readonly roles?: readonly Auth0SeedRole[]
  readonly organizations?: readonly {
    readonly name: string
    readonly display_name?: string
    readonly id?: string
  }[]
  readonly users?: readonly Auth0SeedUser[]
  /** Social logins the login page offers: `google-oauth2`, `github` or `windowslive`. */
  readonly connections?: readonly {
    readonly name: string
    readonly client_id: string
    readonly client_secret: string
  }[]
}

/** Tenants, their applications, APIs, roles, organizations and users, to load into an emulator. */
export interface Auth0SeedConfig {
  readonly tenants?: readonly Auth0SeedTenant[]
}

const DEFAULT_GRANTS: Readonly<Record<Auth0AppType, readonly string[]>> = {
  regular_web: ["authorization_code", "refresh_token", "implicit"],
  spa: ["authorization_code", "refresh_token", "implicit"],
  native: ["authorization_code", "refresh_token", "implicit"],
  non_interactive: ["client_credentials"],
}

function seedApis(auth0: Auth0Store, seed: Auth0SeedTenant): void {
  auth0.apis.insert({
    tenant: seed.domain,
    identifier: managementAudience(seed.domain),
    name: "Auth0 Management API",
    scopes: MANAGEMENT_SCOPES,
    enforcePolicies: false,
    permissionsInToken: false,
    allowOfflineAccess: false,
    tokenLifetimeSeconds: 86_400,
  })

  for (const api of seed.apis ?? [])
    auth0.apis.insert({
      tenant: seed.domain,
      identifier: api.identifier,
      name: api.name ?? api.identifier,
      scopes: [...(api.scopes ?? [])],
      enforcePolicies: api.rbac ?? false,
      permissionsInToken: api.permissions_in_token ?? false,
      allowOfflineAccess: api.allow_offline_access ?? false,
      tokenLifetimeSeconds: api.token_lifetime ?? 86_400,
    })
}

function seedClientGrants(auth0: Auth0Store, domain: string, client: Auth0SeedClient): void {
  const grants = [
    ...(client.management_scopes
      ? [{ audience: managementAudience(domain), scopes: client.management_scopes }]
      : []),
    ...(client.client_grants ?? []),
  ]

  for (const grant of grants)
    auth0.clientGrants.insert({
      grantId: `cgr_${hexId(8)}`,
      tenant: domain,
      client_id: client.client_id,
      audience: grant.audience,
      scope: [...grant.scopes],
    })
}

/** How a seeded client's refresh tokens behave: non-rotating, with no reuse leeway, by default. */
function refreshSettings(client: Auth0SeedClient) {
  return {
    rotation: client.refresh_token?.rotation ?? "non-rotating",
    reuseLeewaySeconds: client.refresh_token?.leeway_seconds ?? 0,
  }
}

function seedClients(auth0: Auth0Store, seed: Auth0SeedTenant): void {
  for (const client of seed.clients ?? []) {
    const type = client.app_type ?? "regular_web"

    auth0.clients.insert({
      tenant: seed.domain,
      client_id: client.client_id,
      client_secret: client.client_secret ?? "",
      name: client.name,
      app_type: type,
      callbacks: [...(client.callbacks ?? [])],
      allowed_logout_urls: [...(client.allowed_logout_urls ?? [])],
      grant_types: [...(client.grant_types ?? DEFAULT_GRANTS[type])],
      ...refreshSettings(client),
    })
    seedClientGrants(auth0, seed.domain, client)
  }
}

function seedRolesAndOrganizations(auth0: Auth0Store, seed: Auth0SeedTenant): void {
  for (const role of seed.roles ?? [])
    auth0.roles.insert({
      tenant: seed.domain,
      roleId: `rol_${hexId(8)}`,
      name: role.name,
      description: role.description ?? "",
      permissions: [...(role.permissions ?? [])],
    })

  for (const org of seed.organizations ?? [])
    auth0.organizations.insert({
      tenant: seed.domain,
      orgId: org.id ?? `org_${hexId(8)}`,
      name: org.name,
      display_name: org.display_name ?? org.name,
      members: [],
    })
}

/** Gives a seeded user their roles and organization memberships, by name. */
function seedMemberships(
  auth0: Auth0Store,
  domain: string,
  userId: string,
  user: Auth0SeedUser,
): void {
  const onTenant = <T extends { tenant: string; name: string }>(
    items: readonly T[],
    name: string,
  ) => items.find((found) => found.tenant === domain && found.name === name)

  for (const name of user.roles ?? []) {
    const role = onTenant(auth0.roles.all(), name)

    if (role) auth0.userRoles.insert({ tenant: domain, user_id: userId, roleId: role.roleId })
  }

  for (const name of user.organizations ?? []) {
    const org = onTenant(auth0.organizations.all(), name)

    if (org) auth0.organizations.update(org.id, { members: [...org.members, userId] })
  }
}

function seedPeople(auth0: Auth0Store, seed: Auth0SeedTenant): void {
  seedRolesAndOrganizations(auth0, seed)

  for (const user of seed.users ?? []) {
    const { roles: _roles, organizations: _organizations, ...profile } = user

    seedMemberships(auth0, seed.domain, insertUser(auth0, seed.domain, profile).user_id, user)
  }
}

/** Loads tenants and what is configured on them into an Auth0 emulator's store. */
export function seedAuth0(store: Store, config: Auth0SeedConfig): void {
  const auth0 = auth0Store(store)

  for (const given of config.tenants ?? []) {
    const seed = { ...given, domain: given.domain.toLowerCase() }

    auth0.tenants.insert({
      domain: seed.domain,
      aliases: (seed.custom_domains ?? []).map((domain) => domain.toLowerCase()),
      friendlyName: seed.friendly_name ?? seed.domain.split(".")[0] ?? seed.domain,
      postLoginClaims: { ...seed.post_login_claims },
      rolesClaim: seed.roles_claim ?? null,
      requireVerifiedEmail: seed.require_verified_email ?? false,
    })
    seedApis(auth0, seed)
    seedClients(auth0, seed)
    seedPeople(auth0, seed)

    for (const connection of seed.connections ?? [])
      auth0.connections.insert({ tenant: seed.domain, ...connection })
  }
}
