import type { OrganizationInvitationJSON } from "@clerk/backend"

import type { App, Context } from "../../http.ts"
import { type ClerkContext, instanceOf, now } from "../context.ts"
import { ClerkFailure } from "../helpers.ts"
import { addMembership, membershipOf } from "../organizations.ts"
import { userByEmail } from "./users.ts"

/** The pending invitation a ticket belongs to, or Clerk's error for a used or unknown one. */
export function invitationForTicket(
  context: ClerkContext,
  ticket: string,
): OrganizationInvitationJSON {
  const invitation = context.clerk.invitations
    .all()
    .find((i) => context.clerk.invitations.extra(i.id)?.ticket === ticket)

  if (!invitation)
    throw new ClerkFailure(
      400,
      "ticket_invalid",
      "Ticket invalid",
      "The ticket you used is invalid or has expired.",
      { param_name: "ticket" },
    )
  if (invitation.status !== "pending" || invitation.expires_at < now(context))
    throw new ClerkFailure(
      400,
      "ticket_expired",
      "Ticket expired",
      "This invitation has already been used, revoked, or has expired.",
      { param_name: "ticket" },
    )

  return invitation
}

/** Accepts an invitation for `userId`: the membership it offered, and the invitation used up. */
export function acceptInvitation(
  context: ClerkContext,
  invitation: OrganizationInvitationJSON,
  userId: string,
): void {
  const orgId = invitation.organization_id ?? ""

  if (!membershipOf(context, orgId, userId)) addMembership(context, orgId, userId, invitation.role)
  context.clerk.invitations.change(invitation.id, { status: "accepted", updated_at: now(context) })
}

/**
 * `GET /v1/tickets/accept`, where an invitation email links: the invitee goes on to the app's page
 * (the invitation's redirect URL, else the Account Portal's sign-up) with the ticket, and
 * `__clerk_status` saying whether to sign up, sign in, or that the invitation is spent.
 */
function acceptTicket(c: Context, context: ClerkContext): Response {
  const ticket = c.req.query("ticket") ?? ""
  const found = context.clerk.invitations
    .all()
    .find((i) => context.clerk.invitations.extra(i.id)?.ticket === ticket)
  const extra = found && context.clerk.invitations.extra(found.id)
  const target = new URL(
    extra?.redirect_url ?? `https://${instanceOf(context).accountsHost}/sign-up`,
  )
  const pending = found?.status === "pending" && found.expires_at >= now(context)
  const status = !pending
    ? "expired"
    : userByEmail(context, found.email_address)
      ? "sign_in"
      : "sign_up"

  target.searchParams.set("__clerk_ticket", ticket)
  target.searchParams.set("__clerk_status", status)

  return c.redirect(target.toString(), 303)
}

/** The Frontend API's ticket link. */
export function ticketRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/tickets/accept", (c) => acceptTicket(c, context))
}
