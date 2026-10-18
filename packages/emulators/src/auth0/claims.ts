import type {
  Auth0ApiRecord,
  Auth0OrganizationRecord,
  Auth0TenantRecord,
  Auth0UserRecord,
} from "./entities.ts"
import type { Auth0Store } from "./store.ts"

/** The names of the roles a user holds. */
export function roleNames(auth0: Auth0Store, user: Auth0UserRecord): string[] {
  return auth0.userRoles
    .findBy("user_id", user.user_id)
    .filter((link) => link.tenant === user.tenant)
    .flatMap((link) => auth0.roles.findBy("roleId", link.roleId).map((role) => role.name))
}

/** The permissions a user's roles grant on one API. */
export function permissionsOn(
  auth0: Auth0Store,
  user: Auth0UserRecord,
  audience: string,
): string[] {
  const granted = auth0.userRoles
    .findBy("user_id", user.user_id)
    .flatMap((link) => auth0.roles.findBy("roleId", link.roleId))
    .flatMap((role) => role.permissions)
    .filter((permission) => permission.resource_server_identifier === audience)
    .map((permission) => permission.permission_name)

  return [...new Set(granted)]
}

/** The scopes a user gets on an API: all asked-for API scopes, or under RBAC only those granted. */
export function apiScopes(
  auth0: Auth0Store,
  user: Auth0UserRecord,
  api: Auth0ApiRecord,
  requested: readonly string[],
): string[] {
  const known = requested.filter((scope) => api.scopes.includes(scope))

  if (!api.enforcePolicies) return known

  const allowed = new Set(permissionsOn(auth0, user, api.identifier))

  return known.filter((scope) => allowed.has(scope))
}

/** The claims a post-login step adds: the tenant's, the roles claim, then the user's own. */
export function postLoginClaims(
  auth0: Auth0Store,
  tenant: Auth0TenantRecord,
  user: Auth0UserRecord,
): Record<string, unknown> {
  return {
    ...tenant.postLoginClaims,
    ...(tenant.rolesClaim !== null && { [tenant.rolesClaim]: roleNames(auth0, user) }),
    ...user.claims,
  }
}

/** The OIDC profile claims a scope list allows. */
export function profileClaims(user: Auth0UserRecord, scopes: readonly string[]) {
  return {
    ...(scopes.includes("profile") && {
      name: user.name,
      nickname: user.nickname,
      picture: user.picture,
      updated_at: user.updated_at,
      ...(user.given_name !== null && { given_name: user.given_name }),
      ...(user.family_name !== null && { family_name: user.family_name }),
    }),
    ...(scopes.includes("email") && { email: user.email, email_verified: user.email_verified }),
  }
}

/** The organization claims for a token issued in an organization's context. */
export function organizationClaims(org: Auth0OrganizationRecord | undefined) {
  return org ? { org_id: org.orgId, org_name: org.name } : {}
}
