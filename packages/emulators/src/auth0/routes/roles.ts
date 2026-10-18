import { isRecord } from "../../json.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0Permission, Auth0RoleRecord } from "../entities.ts"
import { hexId, jsonBody, ManagementError } from "../helpers.ts"
import { managedUser, paged, requireScope, stringsIn } from "../management.ts"

const roleView = (role: Auth0RoleRecord) => ({
  id: role.roleId,
  name: role.name,
  description: role.description,
})

function permissionsIn(value: unknown): Auth0Permission[] {
  if (!Array.isArray(value)) return []

  return value.filter(isRecord).map((item) => ({
    resource_server_identifier:
      typeof item.resource_server_identifier === "string" ? item.resource_server_identifier : "",
    permission_name: typeof item.permission_name === "string" ? item.permission_name : "",
  }))
}

function roleOf(context: Auth0RouteContext, tenant: string, id: string): Auth0RoleRecord {
  const role = context
    .auth0()
    .roles.findBy("roleId", id)
    .find((found) => found.tenant === tenant)

  if (!role) throw new ManagementError(404, "The role does not exist.", "inexistent_role")

  return role
}

function roleRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/roles", (c) => {
    const { tenant } = requireScope(c, "read:roles")
    const name = c.req.query("name_filter")?.toLowerCase()
    const roles = context
      .auth0()
      .roles.all()
      .filter(
        (role) =>
          role.tenant === tenant.domain &&
          (name === undefined || role.name.toLowerCase().includes(name)),
      )

    return paged(c, "roles", roles.map(roleView))
  })

  app.post("/api/v2/roles", async (c) => {
    const { tenant } = requireScope(c, "create:roles")
    const body = await jsonBody(c)
    const name = typeof body.name === "string" ? body.name : ""

    if (name === "")
      throw new ManagementError(
        400,
        "Payload validation error: 'Missing required property: name'.",
        "invalid_body",
      )

    const role = context.auth0().roles.insert({
      tenant: tenant.domain,
      roleId: `rol_${hexId(8)}`,
      name,
      description: typeof body.description === "string" ? body.description : "",
      permissions: [],
    })

    return c.json(roleView(role), 200)
  })

  app.get("/api/v2/roles/:id", (c) => {
    const { tenant } = requireScope(c, "read:roles")

    return c.json(roleView(roleOf(context, tenant.domain, c.req.param("id"))))
  })

  app.delete("/api/v2/roles/:id", (c) => {
    const { tenant } = requireScope(c, "delete:roles")
    const role = roleOf(context, tenant.domain, c.req.param("id"))
    const auth0 = context.auth0()

    for (const link of auth0.userRoles.all().filter((found) => found.roleId === role.roleId))
      auth0.userRoles.delete(link.id)
    auth0.roles.delete(role.id)

    return c.body(null, 200)
  })
}

function rolePermissionRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/roles/:id/permissions", (c) => {
    const { tenant } = requireScope(c, "read:roles")

    return paged(c, "permissions", roleOf(context, tenant.domain, c.req.param("id")).permissions)
  })

  app.post("/api/v2/roles/:id/permissions", async (c) => {
    const { tenant } = requireScope(c, "update:roles")
    const role = roleOf(context, tenant.domain, c.req.param("id"))
    const added = permissionsIn((await jsonBody(c)).permissions)
    const kept = role.permissions.filter(
      (have) =>
        !added.some(
          (add) =>
            add.permission_name === have.permission_name &&
            add.resource_server_identifier === have.resource_server_identifier,
        ),
    )

    context.auth0().roles.update(role.id, { permissions: [...kept, ...added] })

    return c.body(null, 201)
  })

  app.get("/api/v2/roles/:id/users", (c) => {
    const { tenant } = requireScope(c, "read:role_members")
    const role = roleOf(context, tenant.domain, c.req.param("id"))
    const auth0 = context.auth0()
    const users = auth0.userRoles
      .all()
      .filter((link) => link.roleId === role.roleId)
      .flatMap((link) => auth0.users.findBy("user_id", link.user_id))

    return paged(
      c,
      "users",
      users.map((user) => ({
        user_id: user.user_id,
        email: user.email,
        picture: user.picture,
        name: user.name,
      })),
    )
  })
}

/** The roles a user has been given. */
function rolesOfUser(context: Auth0RouteContext, userId: string): Auth0RoleRecord[] {
  const auth0 = context.auth0()

  return auth0.userRoles
    .findBy("user_id", userId)
    .flatMap((link) => auth0.roles.findBy("roleId", link.roleId))
}

function userRoleRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/users/:id/roles", (c) => {
    const { tenant } = requireScope(c, "read:users")
    const user = managedUser(context, tenant.domain, c.req.param("id"))

    return paged(c, "roles", rolesOfUser(context, user.user_id).map(roleView))
  })

  app.post("/api/v2/users/:id/roles", async (c) => {
    const { tenant } = requireScope(c, "create:role_members")
    const user = managedUser(context, tenant.domain, c.req.param("id"))
    const auth0 = context.auth0()
    const have = new Set(auth0.userRoles.findBy("user_id", user.user_id).map((link) => link.roleId))

    for (const roleId of stringsIn((await jsonBody(c)).roles)) {
      roleOf(context, tenant.domain, roleId)
      if (!have.has(roleId))
        auth0.userRoles.insert({ tenant: tenant.domain, user_id: user.user_id, roleId })
    }

    return c.body(null, 204)
  })

  app.delete("/api/v2/users/:id/roles", async (c) => {
    const { tenant } = requireScope(c, "update:users")
    const user = managedUser(context, tenant.domain, c.req.param("id"))
    const remove = new Set(stringsIn((await jsonBody(c)).roles))
    const auth0 = context.auth0()

    for (const link of auth0.userRoles.findBy("user_id", user.user_id))
      if (remove.has(link.roleId)) auth0.userRoles.delete(link.id)

    return c.body(null, 204)
  })

  app.get("/api/v2/users/:id/permissions", (c) => {
    const { tenant } = requireScope(c, "read:users")
    const user = managedUser(context, tenant.domain, c.req.param("id"))
    const merged = new Map<
      string,
      Auth0Permission & {
        sources: { source_id: string; source_name: string; source_type: string }[]
      }
    >()

    for (const role of rolesOfUser(context, user.user_id))
      for (const permission of role.permissions) {
        const key = `${permission.resource_server_identifier} ${permission.permission_name}`
        const entry = merged.get(key) ?? { ...permission, sources: [] }

        entry.sources.push({
          source_id: role.roleId,
          source_name: role.name,
          source_type: "ROLE",
        })
        merged.set(key, entry)
      }

    return paged(c, "permissions", [...merged.values()])
  })

  app.get("/api/v2/users/:id/organizations", (c) => {
    const { tenant } = requireScope(c, "read:organizations")
    const user = managedUser(context, tenant.domain, c.req.param("id"))
    const orgs = context
      .auth0()
      .organizations.all()
      .filter((org) => org.tenant === tenant.domain && org.members.includes(user.user_id))

    return paged(
      c,
      "organizations",
      orgs.map((org) => ({ id: org.orgId, name: org.name, display_name: org.display_name })),
    )
  })
}

/** The Management API's roles, their permissions and members, and users' roles and permissions. */
export function roleManagementRoutes(context: Auth0RouteContext): void {
  for (const register of [roleRoutes, rolePermissionRoutes, userRoleRoutes]) register(context)
}
