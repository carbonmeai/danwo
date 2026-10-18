import type { Context } from "../../http.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0OrganizationRecord } from "../entities.ts"
import { hexId, jsonBody, ManagementError } from "../helpers.ts"
import { paged, requireScope, stringsIn } from "../management.ts"

const orgView = (org: Auth0OrganizationRecord) => ({
  id: org.orgId,
  name: org.name,
  display_name: org.display_name,
})

function orgOf(
  context: Auth0RouteContext,
  tenant: string,
  match: (org: Auth0OrganizationRecord) => boolean,
) {
  const org = context
    .auth0()
    .organizations.all()
    .find((found) => found.tenant === tenant && match(found))

  if (!org)
    throw new ManagementError(
      404,
      "No organization found by that id or name",
      "inexistent_organization",
    )

  return org
}

function organizationRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/organizations", (c) => {
    const { tenant } = requireScope(c, "read:organizations")

    return paged(
      c,
      "organizations",
      context
        .auth0()
        .organizations.all()
        .filter((org) => org.tenant === tenant.domain)
        .map(orgView),
    )
  })

  app.post("/api/v2/organizations", async (c) => {
    const { tenant } = requireScope(c, "create:organizations")
    const body = await jsonBody(c)
    const name = typeof body.name === "string" ? body.name : ""

    if (!/^[a-z0-9_-]+$/.test(name))
      throw new ManagementError(
        400,
        "Payload validation error: 'String does not match pattern' on property name.",
        "invalid_body",
      )
    if (
      context
        .auth0()
        .organizations.all()
        .some((org) => org.tenant === tenant.domain && org.name === name)
    )
      throw new ManagementError(
        409,
        "An organization with this name already exists.",
        "organization_conflict",
      )

    const org = context.auth0().organizations.insert({
      tenant: tenant.domain,
      orgId: `org_${hexId(8)}`,
      name,
      display_name: typeof body.display_name === "string" ? body.display_name : name,
      members: [],
    })

    return c.json(orgView(org), 201)
  })

  app.get("/api/v2/organizations/name/:name", (c) => {
    const { tenant } = requireScope(c, "read:organizations")

    return c.json(orgView(orgOf(context, tenant.domain, (org) => org.name === c.req.param("name"))))
  })

  app.get("/api/v2/organizations/:id", (c) => {
    const { tenant } = requireScope(c, "read:organizations")

    return c.json(orgView(orgOf(context, tenant.domain, (org) => org.orgId === c.req.param("id"))))
  })

  app.delete("/api/v2/organizations/:id", (c) => {
    const { tenant } = requireScope(c, "delete:organizations")

    context
      .auth0()
      .organizations.delete(
        orgOf(context, tenant.domain, (org) => org.orgId === c.req.param("id")).id,
      )

    return c.body(null, 204)
  })
}

function memberRoutes(context: Auth0RouteContext): void {
  const { app } = context
  const byId = (c: Context, tenant: string) =>
    orgOf(context, tenant, (org) => org.orgId === c.req.param("id"))

  app.get("/api/v2/organizations/:id/members", (c) => {
    const { tenant } = requireScope(c, "read:organization_members")
    const auth0 = context.auth0()
    const members = byId(c, tenant.domain).members.flatMap((userId) =>
      auth0.users.findBy("user_id", userId),
    )

    return paged(
      c,
      "members",
      members.map((user) => ({
        user_id: user.user_id,
        email: user.email,
        picture: user.picture,
        name: user.name,
      })),
    )
  })

  app.post("/api/v2/organizations/:id/members", async (c) => {
    const { tenant } = requireScope(c, "create:organization_members")
    const org = byId(c, tenant.domain)
    const added = stringsIn((await jsonBody(c)).members).filter(
      (userId) => !org.members.includes(userId),
    )

    context.auth0().organizations.update(org.id, { members: [...org.members, ...added] })

    return c.body(null, 204)
  })

  app.delete("/api/v2/organizations/:id/members", async (c) => {
    const { tenant } = requireScope(c, "delete:organization_members")
    const org = byId(c, tenant.domain)
    const removed = new Set(stringsIn((await jsonBody(c)).members))

    context.auth0().organizations.update(org.id, {
      members: org.members.filter((userId) => !removed.has(userId)),
    })

    return c.body(null, 204)
  })
}

/** The Management API's organizations and their members. */
export function organizationManagementRoutes(context: Auth0RouteContext): void {
  for (const register of [organizationRoutes, memberRoutes]) register(context)
}
