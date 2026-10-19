import type { App, Context } from "../../http.ts"
import { bodyOf, pageOf } from "../backend-auth.ts"
import { type ClerkContext, now } from "../context.ts"
import { invalidParameter, notFound, num, record, str } from "../helpers.ts"
import {
  addMembership,
  createOrganization,
  inviteToOrganization,
  membershipJson,
  membershipOf,
  organizationJson,
  organizationOf,
} from "../organizations.ts"
import { userOf } from "./users.ts"

/** A page of `items` in Clerk's paginated shape. */
function paginated<T>(c: Context, items: readonly T[]) {
  const { limit, offset } = pageOf(c)

  return { data: items.slice(offset, offset + limit), total_count: items.length }
}

function organizationCrud(app: App, context: ClerkContext): void {
  app.get("/v1/organizations", (c) => {
    const query = c.req.query("query")?.toLowerCase()
    const orgs = context.clerk.organizations
      .where((o) => query === undefined || `${o.name} ${o.slug}`.toLowerCase().includes(query))
      .map((o) => organizationJson(context, o))

    return c.json(paginated(c, orgs))
  })
  app.post("/v1/organizations", async (c) => {
    const body = await bodyOf(c)
    const name = str(body.name)

    if (name === undefined) throw invalidParameter("name", "name is required.")

    const createdBy = str(body.created_by)
    const slug = str(body.slug)
    const max = num(body.max_allowed_memberships)
    const org = createOrganization(context, {
      name,
      ...(slug !== undefined && { slug }),
      ...(createdBy !== undefined && { createdBy: userOf(context, createdBy).id }),
      publicMetadata: record(body.public_metadata),
      privateMetadata: record(body.private_metadata),
      ...(max !== undefined && { maxAllowedMemberships: max }),
    })

    return c.json(organizationJson(context, org))
  })
  app.get("/v1/organizations/:id", (c) =>
    c.json(organizationJson(context, organizationOf(context, c.req.param("id")))),
  )
  app.patch("/v1/organizations/:id", async (c) => {
    const org = organizationOf(context, c.req.param("id"))
    const body = await bodyOf(c)
    const name = str(body.name)
    const slug = str(body.slug)
    const changed = context.clerk.organizations.change(org.id, {
      ...(name !== undefined && { name }),
      ...(slug !== undefined && { slug }),
      updated_at: now(context),
    })
    const json = organizationJson(context, changed ?? org)

    context.events.organization("organization.updated", json)

    return c.json(json)
  })
  app.delete("/v1/organizations/:id", (c) => {
    const org = organizationOf(context, c.req.param("id"))

    for (const m of context.clerk.memberships.where((x) => x.organization_id === org.id))
      context.clerk.memberships.remove(m.id)
    context.clerk.organizations.remove(org.id)
    context.events.organizationDeleted(org.id)

    return c.json({ object: "organization", id: org.id, slug: org.slug, deleted: true })
  })
}

function membershipRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/organizations/:id/memberships", (c) => {
    const org = organizationOf(context, c.req.param("id"))
    const members = context.clerk.memberships
      .where((m) => m.organization_id === org.id)
      .map((m) => membershipJson(context, m))

    return c.json(paginated(c, members))
  })
  app.post("/v1/organizations/:id/memberships", async (c) => {
    const org = organizationOf(context, c.req.param("id"))
    const body = await bodyOf(c)
    const userId = userOf(context, str(body.user_id) ?? "").id
    const role = str(body.role) ?? "org:member"

    return c.json(membershipJson(context, addMembership(context, org.id, userId, role)))
  })
  app.patch("/v1/organizations/:id/memberships/:user", async (c) => {
    const org = organizationOf(context, c.req.param("id"))
    const membership = membershipOf(context, org.id, c.req.param("user"))
    const role = str((await bodyOf(c)).role)

    if (!membership) throw notFound("organization membership")
    if (role === undefined) throw invalidParameter("role")

    const changed = context.clerk.memberships.change(membership.id, {
      role,
      updated_at: now(context),
    })
    const json = membershipJson(context, changed ?? membership)

    context.events.membership("organizationMembership.updated", json)

    return c.json(json)
  })
  app.delete("/v1/organizations/:id/memberships/:user", (c) => {
    const org = organizationOf(context, c.req.param("id"))
    const membership = membershipOf(context, org.id, c.req.param("user"))

    if (!membership) throw notFound("organization membership")

    const json = membershipJson(context, membership)

    context.clerk.memberships.remove(membership.id)
    context.events.membership("organizationMembership.deleted", json)

    return c.json(json)
  })
  app.get("/v1/users/:id/organization_memberships", (c) => {
    const user = userOf(context, c.req.param("id"))
    const members = context.clerk.memberships
      .where((m) => m.user_id === user.id)
      .map((m) => membershipJson(context, m))

    return c.json(paginated(c, members))
  })
}

function invitationRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/organizations/:id/invitations", (c) => {
    const org = organizationOf(context, c.req.param("id"))
    const status = c.req.query("status")

    return c.json(
      paginated(
        c,
        context.clerk.invitations.where(
          (i) => i.organization_id === org.id && (status === undefined || i.status === status),
        ),
      ),
    )
  })
  app.post("/v1/organizations/:id/invitations", async (c) => {
    const body = await bodyOf(c)
    const email = str(body.email_address)

    if (email === undefined) throw invalidParameter("email_address")

    return c.json(
      inviteToOrganization(context, c.req.param("id"), email, str(body.role) ?? "org:member"),
    )
  })
  app.post("/v1/organizations/:id/invitations/:invitation/revoke", (c) => {
    const id = c.req.param("invitation")
    const changed = context.clerk.invitations.change(id, {
      status: "revoked",
      updated_at: now(context),
    })

    if (!changed) throw notFound("organization invitation")

    return c.json(changed)
  })
}

/** The Backend API's organizations, memberships and organization invitations. */
export function organizationRoutes(app: App, context: ClerkContext): void {
  organizationCrud(app, context)
  membershipRoutes(app, context)
  invitationRoutes(app, context)
}
