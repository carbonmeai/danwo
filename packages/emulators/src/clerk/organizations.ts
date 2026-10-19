import type {
  OrganizationInvitationJSON,
  OrganizationJSON,
  OrganizationMembershipJSON,
} from "@clerk/backend"

import { type ClerkContext, instanceOf, now } from "./context.ts"
import { type ClerkUser, primaryEmail } from "./entities.ts"
import { clerkId, ClerkFailure, notFound } from "./helpers.ts"
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
export function organizationOf(context: ClerkContext, idOrSlug: string): OrganizationJSON {
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
): OrganizationJSON {
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

/** An organization with its member count, as the API answers it. */
export function organizationJson(context: ClerkContext, org: OrganizationJSON): OrganizationJSON {
  const members = context.clerk.memberships.where((m) => m.organization_id === org.id).length

  return { ...org, members_count: members }
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
      user_id: userId,
    }

  return {
    identifier: primaryEmail(user) ?? user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    image_url: user.image_url,
    has_image: user.has_image,
    user_id: userId,
  }
}

/** A membership with both its organization and the member's public data, as the API answers it. */
export function membershipJson(
  context: ClerkContext,
  membership: MembershipRecord,
): OrganizationMembershipJSON {
  const org = organizationOf(context, membership.organization_id)

  return {
    object: "organization_membership",
    id: membership.id,
    role: membership.role,
    permissions: [...(PERMISSIONS[membership.role] ?? [])],
    public_metadata: membership.public_metadata,
    private_metadata: membership.private_metadata,
    created_at: membership.created_at,
    updated_at: membership.updated_at,
    organization: organizationJson(context, org),
    public_user_data: memberData(context.clerk.users.get(membership.user_id), membership.user_id),
  }
}

/** Invites `email` to an organization with `role`, as a pending invitation valid for 30 days. */
export function inviteToOrganization(
  context: ClerkContext,
  orgId: string,
  email: string,
  role: string,
): OrganizationInvitationJSON {
  const org = organizationOf(context, orgId)
  const at = now(context)
  const id = clerkId("orginv")

  return context.clerk.invitations.add(
    {
      object: "organization_invitation",
      id,
      email_address: email,
      role,
      role_name: role === "org:admin" ? "Admin" : "Member",
      organization_id: org.id,
      public_organization_data: {
        object: "organization",
        id: org.id,
        name: org.name,
        slug: org.slug,
        image_url: org.image_url ?? "",
        has_image: org.has_image,
      },
      status: "pending",
      public_metadata: {},
      private_metadata: {},
      url: `https://${instanceOf(context).accountsHost}/sign-up?__clerk_ticket=${id}`,
      created_at: at,
      updated_at: at,
      expires_at: at + 30 * 24 * 60 * 60 * 1000,
    },
    null,
  )
}
