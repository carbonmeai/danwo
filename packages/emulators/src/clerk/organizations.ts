import type { OrganizationInvitationJSON, OrganizationMembershipJSON } from "@clerk/backend"

import { type ClerkContext, instanceOf, now } from "./context.ts"
import { type ClerkOrganization, type ClerkUser, primaryEmail } from "./entities.ts"
import { clerkId, ClerkFailure, notFound, secretToken } from "./helpers.ts"
import type { MembershipRecord } from "./store.ts"

/** The permissions Clerk's two default roles carry. */
const PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "org:admin": [
    "org:sys_profile:manage",
    "org:sys_profile:delete",
    "org:sys_memberships:read",
    "org:sys_memberships:manage",
    "org:sys_domains:read",
    "org:sys_domains:manage",
  ],
  "org:member": ["org:sys_memberships:read"],
}

/** An organization by id or slug, or 404. */
export function organizationOf(context: ClerkContext, idOrSlug: string): ClerkOrganization {
  const org =
    context.clerk.organizations.get(idOrSlug) ??
    context.clerk.organizations.where((o) => o.slug === idOrSlug)[0]

  if (!org) throw notFound("organization")

  return org
}

/** A slug from a name: lower case, dashes for anything else. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** The fields an organization is created with. */
export interface NewOrganization {
  /** A fixed id, for seeded organizations; otherwise a random one. */
  readonly id?: string
  readonly name: string
  readonly slug?: string
  readonly createdBy?: string
  readonly publicMetadata?: Record<string, unknown>
  readonly privateMetadata?: Record<string, unknown>
  readonly maxAllowedMemberships?: number
}

/** Creates an organization; its creator, if given, becomes its first admin. */
export function createOrganization(
  context: ClerkContext,
  fields: NewOrganization,
): ClerkOrganization {
  const slug = fields.slug ?? slugify(fields.name)

  if (context.clerk.organizations.where((o) => o.slug === slug).length > 0)
    throw new ClerkFailure(400, "form_identifier_exists", "That slug is taken. Please try another.")

  const at = now(context)
  const org = context.clerk.organizations.add(
    {
      object: "organization",
      id: fields.id ?? clerkId("org"),
      name: fields.name,
      slug,
      image_url: "https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCJ9",
      has_image: false,
      max_allowed_memberships: fields.maxAllowedMemberships ?? 5,
      admin_delete_enabled: true,
      self_serve_sso_enabled: false,
      self_serve_directory_sync_enabled: false,
      logo_url: null,
      public_metadata: fields.publicMetadata ?? {},
      private_metadata: fields.privateMetadata ?? {},
      ...(fields.createdBy !== undefined && { created_by: fields.createdBy }),
      created_at: at,
      updated_at: at,
    },
    null,
  )

  context.events.organization("organization.created", organizationJson(context, org))
  if (fields.createdBy !== undefined) addMembership(context, org.id, fields.createdBy, "org:admin")

  return org
}

/** Adds `userId` to an organization with `role`, refusing a second membership. */
export function addMembership(
  context: ClerkContext,
  orgId: string,
  userId: string,
  role: string,
  id = clerkId("orgmem"),
): MembershipRecord {
  if (membershipOf(context, orgId, userId))
    throw new ClerkFailure(
      400,
      "already_a_member_in_organization",
      "already a member",
      "User is already a member of the organization.",
    )

  const at = now(context)

  const membership = context.clerk.memberships.add(
    {
      id,
      organization_id: orgId,
      user_id: userId,
      role,
      public_metadata: {},
      private_metadata: {},
      created_at: at,
      updated_at: at,
    },
    null,
  )

  context.events.membership("organizationMembership.created", membershipJson(context, membership))

  return membership
}

/** A user's membership in an organization, if any. */
export function membershipOf(
  context: ClerkContext,
  orgId: string,
  userId: string,
): MembershipRecord | undefined {
  return context.clerk.memberships.where(
    (m) => m.organization_id === orgId && m.user_id === userId,
  )[0]
}

/** An organization as the Backend API answers it on its own: without counts. */
export function organizationJson(
  _context: ClerkContext,
  org: ClerkOrganization,
): ClerkOrganization {
  const { members_count: _members, pending_invitations_count: _pending, ...rest } = org

  return rest
}

/**
 * An organization as a membership carries it: with its member and pending invitation counts.
 */
function countedOrganization(context: ClerkContext, org: ClerkOrganization): ClerkOrganization {
  const members = context.clerk.memberships.where((m) => m.organization_id === org.id).length
  const pending = context.clerk.invitations.where(
    (i) => i.organization_id === org.id && i.status === "pending",
  ).length

  return {
    ...organizationJson(context, org),
    members_count: members,
    pending_invitations_count: pending,
  }
}

/** A member's public face on a membership; a deleted user keeps only their id. */
function memberData(user: ClerkUser | undefined, userId: string) {
  if (!user)
    return {
      identifier: userId,
      first_name: null,
      last_name: null,
      image_url: "",
      has_image: false,
      username: null,
      profile_image_url: "",
      user_id: userId,
      banned: false,
      deprovisioned: true,
    }

  return {
    identifier: primaryEmail(user) ?? user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    image_url: user.image_url,
    has_image: user.has_image,
    username: user.username,
    profile_image_url: user.profile_image_url,
    user_id: userId,
    banned: user.banned,
    deprovisioned: user.deprovisioned,
  }
}

/** A membership with both its organization and the member's public data, as the API answers it. */
export function membershipJson(
  context: ClerkContext,
  membership: MembershipRecord,
): OrganizationMembershipJSON & { role_name: string } {
  const org = organizationOf(context, membership.organization_id)

  return {
    object: "organization_membership",
    id: membership.id,
    role: membership.role,
    role_name: roleName(membership.role),
    permissions: [...(PERMISSIONS[membership.role] ?? [])],
    public_metadata: membership.public_metadata,
    private_metadata: membership.private_metadata,
    created_at: membership.created_at,
    updated_at: membership.updated_at,
    organization: countedOrganization(context, org),
    public_user_data: memberData(context.clerk.users.get(membership.user_id), membership.user_id),
  }
}

/** An organization's memberships, as the API answers them. */
export function membersOf(
  context: ClerkContext,
  orgId: string,
): (OrganizationMembershipJSON & { role_name: string })[] {
  return context.clerk.memberships
    .where((m) => m.organization_id === orgId)
    .map((m) => membershipJson(context, m))
}

/** A role's display name, as Clerk names its built-in roles. */
function roleName(role: string): string {
  return role === "org:admin" ? "Admin" : "Member"
}

/** Who sent an invitation, when the request names them: their id and public face. */
function inviterOf(context: ClerkContext, inviterId: string | undefined) {
  const inviter = inviterId === undefined ? undefined : context.clerk.users.get(inviterId)

  if (!inviter) return {}

  return {
    inviter_id: inviter.id,
    public_inviter_data: {
      user_id: inviter.id,
      first_name: inviter.first_name,
      last_name: inviter.last_name,
      image_url: inviter.image_url,
      has_image: inviter.has_image,
      identifier: primaryEmail(inviter) ?? inviter.id,
    },
  }
}

/**
 * Invites `email` to an organization with `role`, as a pending invitation valid for 30 days, and
 * emails it: the link goes to the Frontend API's `/v1/tickets/accept`, which sends the invitee on
 * to `redirectUrl` (the app's sign-up or sign-in page) with the ticket, or to the Account Portal.
 */
export function inviteToOrganization(
  context: ClerkContext,
  orgId: string,
  email: string,
  role: string,
  inviterId?: string,
  redirectUrl?: string,
): OrganizationInvitationJSON {
  const org = organizationOf(context, orgId)
  const at = now(context)
  const id = clerkId("orginv")
  const ticket = secretToken(32)
  const url = `https://${instanceOf(context).frontendApi}/v1/tickets/accept?ticket=${ticket}`
  const inviter = inviterId === undefined ? undefined : context.clerk.users.get(inviterId)
  const by = inviter ? (inviter.first_name ?? primaryEmail(inviter) ?? "Someone") : "Someone"

  context.clerk.messages.add(
    {
      id: clerkId("msg"),
      to: email,
      subject: `${by} invited you to join ${org.name}`,
      body: `${by} invited you to join ${org.name}. Accept the invitation: ${url} The invitation expires in 30 days.`,
      code: null,
      sent_at: at,
    },
    null,
  )

  return context.clerk.invitations.add(
    {
      object: "organization_invitation",
      id,
      email_address: email,
      role,
      role_name: roleName(role),
      organization_id: org.id,
      ...inviterOf(context, inviterId),
      status: "pending",
      public_metadata: {},
      private_metadata: {},
      url,
      created_at: at,
      updated_at: at,
      expires_at: at + 30 * 24 * 60 * 60 * 1000,
    },
    { ticket, redirect_url: redirectUrl ?? null },
  )
}
