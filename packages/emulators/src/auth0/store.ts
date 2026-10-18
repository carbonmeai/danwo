import type { Entity, Store } from "../store.ts"
import type {
  Auth0ApiRecord,
  Auth0ClientGrantRecord,
  Auth0ClientRecord,
  Auth0CodeRecord,
  Auth0ConnectionRecord,
  Auth0EmailRecord,
  Auth0JobRecord,
  Auth0LoginRecord,
  Auth0OpaqueTokenRecord,
  Auth0OrganizationRecord,
  Auth0RefreshRecord,
  Auth0RoleRecord,
  Auth0SessionRecord,
  Auth0TenantRecord,
  Auth0TransactionRecord,
  Auth0UserRecord,
  Auth0UserRoleRecord,
} from "./entities.ts"

/** Tenants and what is configured on them: applications, APIs, connections, users, roles. */
function directoryTables(store: Store) {
  const table = <T extends Entity>(kind: string, ...indexed: (keyof T)[]) =>
    store.collection<T>(`auth0.${kind}`, indexed)

  return {
    tenants: table<Auth0TenantRecord>("tenants", "domain"),
    clients: table<Auth0ClientRecord>("clients", "client_id"),
    apis: table<Auth0ApiRecord>("apis", "identifier"),
    clientGrants: table<Auth0ClientGrantRecord>("client_grants", "client_id"),
    connections: table<Auth0ConnectionRecord>("connections", "tenant"),
    users: table<Auth0UserRecord>("users", "user_id", "email"),
    roles: table<Auth0RoleRecord>("roles", "roleId"),
    userRoles: table<Auth0UserRoleRecord>("user_roles", "user_id"),
    organizations: table<Auth0OrganizationRecord>("organizations", "orgId"),
  }
}

/** Logins in flight and what they hand out: codes, sessions and tokens, plus what was sent. */
function activityTables(store: Store) {
  const table = <T extends Entity>(kind: string, ...indexed: (keyof T)[]) =>
    store.collection<T>(`auth0.${kind}`, indexed)

  return {
    transactions: table<Auth0TransactionRecord>("transactions", "txn"),
    codes: table<Auth0CodeRecord>("codes", "code"),
    sessions: table<Auth0SessionRecord>("sessions", "sid"),
    refreshTokens: table<Auth0RefreshRecord>("refresh_tokens", "token", "family"),
    opaqueTokens: table<Auth0OpaqueTokenRecord>("opaque_tokens", "token"),
    logins: table<Auth0LoginRecord>("logins", "user_id"),
    emails: table<Auth0EmailRecord>("emails", "ticket"),
    jobs: table<Auth0JobRecord>("jobs", "jobId"),
  }
}

/** The Auth0 state held in an emulator's store. */
export function auth0Store(store: Store) {
  return { ...directoryTables(store), ...activityTables(store) }
}

export type Auth0Store = ReturnType<typeof auth0Store>
