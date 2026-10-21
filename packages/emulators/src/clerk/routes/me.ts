import type { App, Context } from "../../http.ts"
import { bodyOf, pageOf } from "../backend-auth.ts"
import { type BrowserRequest, browserRequest, currentClient, reply } from "../browser-request.ts"
import type { ClerkContext } from "../context.ts"
import type { ClerkUser } from "../entities.ts"
import { ClerkFailure, missingParameter, notFound, str } from "../helpers.ts"
import {
  createOrganization,
  membersOf,
  membershipJson,
  membershipOf,
  organizationJson,
  organizationOf,
} from "../organizations.ts"
import { activeSession } from "../sessions.ts"

/**
 * The signed-in user a Frontend API request acts for: the session ClerkJS names in
 * `_clerk_session_id`, else the client's active one. Signed out is 401 `signed_out`.
 */
function signedInUser(c: Context, context: ClerkContext, request: BrowserRequest): ClerkUser {
  const client = currentClient(context, request)
  const named = c.req.query("_clerk_session_id")
  const session =
    named !== undefined && client.session_ids.includes(named)
      ? context.clerk.sessions.get(named)
      : activeSession(context, client)
  const user = session?.status === "active" ? context.clerk.users.get(session.user_id) : undefined

  if (!user) throw new ClerkFailure(401, "signed_out", "Signed out", "You are signed out.")

  return user
}

/** A page of `items`, as the Frontend API answers `paginated=true` lists. */
function page<T>(c: Context, items: readonly T[]) {
  const { limit, offset } = pageOf(c)

  return { data: items.slice(offset, offset + limit), total_count: items.length }
}

/** The organizations' invitations to the user's email addresses, as the invitee sees them. */
function invitationsFor(context: ClerkContext, user: ClerkUser, status: string | undefined) {
  const emails = new Set(user.email_addresses.map((e) => e.email_address.toLowerCase()))

  return context.clerk.invitations
    .where(
      (i) =>
        emails.has(i.email_address.toLowerCase()) && (status === undefined || i.status === status),
    )
    .map((i) => {
      const org = organizationOf(context, i.organization_id ?? "")

      return {
        object: "organization_invitation",
        id: i.id,
        email_address: i.email_address,
        public_organization_data: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          has_image: org.has_image,
          image_url: org.image_url,
        },
        public_metadata: i.public_metadata,
        role: i.role,
        status: i.status,
        created_at: i.created_at,
        updated_at: i.updated_at,
      }
    })
}

/** The user's own lists: memberships, invitations to them, and suggestions (none). */
function meRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/me/organization_memberships", (c) => {
    const request = browserRequest(c, context)
    const user = signedInUser(c, context, request)
    const memberships = context.clerk.memberships
      .where((m) => m.user_id === user.id)
      .toSorted((a, b) => a.created_at - b.created_at)
      .map((m) => membershipJson(context, m))

    return reply(c, context, request, page(c, memberships))
  })
  app.get("/v1/me/organization_invitations", (c) => {
    const request = browserRequest(c, context)
    const user = signedInUser(c, context, request)

    return reply(c, context, request, page(c, invitationsFor(context, user, c.req.query("status"))))
  })
  app.get("/v1/me/organization_suggestions", (c) => {
    const request = browserRequest(c, context)

    signedInUser(c, context, request)

    return reply(c, context, request, page(c, []))
  })
}

/** The organization in the path, when the signed-in user belongs to it; else 404. */
function memberOrganization(c: Context, context: ClerkContext, request: BrowserRequest) {
  const user = signedInUser(c, context, request)
  const org = organizationOf(context, c.req.param("id"))

  if (!membershipOf(context, org.id, user.id)) throw notFound("organization")

  return org
}

/** The organization routes a member's browser calls: create one, read it, list its members. */
function organizationRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/organizations", async (c) => {
    const request = browserRequest(c, context)
    const user = signedInUser(c, context, request)
    const body = await bodyOf(c)
    const name = str(body.name)

    if (name === undefined) throw missingParameter("name")

    const slug = str(body.slug)
    const org = createOrganization(context, {
      name,
      ...(slug !== undefined && slug !== "" && { slug }),
      createdBy: user.id,
    })

    return reply(c, context, request, organizationJson(context, org))
  })
  app.get("/v1/organizations/:id", (c) => {
    const request = browserRequest(c, context)
    const org = memberOrganization(c, context, request)

    return reply(c, context, request, organizationJson(context, org))
  })
  app.get("/v1/organizations/:id/memberships", (c) => {
    const request = browserRequest(c, context)
    const org = memberOrganization(c, context, request)
    const members = membersOf(context, org.id)

    return reply(c, context, request, page(c, members))
  })
}

/**
 * The Frontend API's organization calls for the signed-in user, which `<OrganizationSwitcher/>`
 * and `<OrganizationProfile/>` make: their memberships, the invitations to their email addresses,
 * creating an organization, and an organization's members.
 */
export function meApiRoutes(app: App, context: ClerkContext): void {
  meRoutes(app, context)
  organizationRoutes(app, context)
}
