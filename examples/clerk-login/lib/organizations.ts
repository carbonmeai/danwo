/**
 * Organizations through Clerk's Backend API: create one, invite someone, and read who belongs.
 * Clerk takes no idempotency key, so each write first looks for what an earlier try (or a second
 * click) already made, and only then makes it.
 */
import { clerkClient } from "@clerk/nextjs/server"

import { appMembers } from "./accounts.ts"
import { backend, clerkErrorCode, type Reach, retryable } from "./clerk.ts"
import { withRetry } from "./retry.ts"

/** An organization's page: its members as Clerk and the app see them, and who is invited. */
export interface OrganizationView {
  readonly id: string
  readonly name: string
  readonly slug: string
  /** The signed-in user's role in it. */
  readonly role: string
  readonly members: readonly Member[]
  readonly invitations: readonly Invitation[]
}

/** One member, with whether the app's own database has their membership yet. */
export interface Member {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: string
  readonly inApp: boolean
}

/** A pending invitation. */
export interface Invitation {
  readonly id: string
  readonly email: string
  readonly role: string
}

/** An organization the user belongs to, for the list on their page. */
export interface OrganizationSummary {
  readonly id: string
  readonly name: string
  readonly role: string
}

/** A slug from a name, as Clerk makes one: lower case, dashes for anything else. */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** The organizations `userId` belongs to, oldest first. */
export async function organizationsOf(
  userId: string,
  reach: Reach = backend,
): Promise<OrganizationSummary[]> {
  const { data } = await reach((clerk) =>
    clerk.users.getOrganizationMembershipList({ userId, limit: 100 }),
  )

  return data
    .toSorted((a, b) => a.createdAt - b.createdAt)
    .map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role }))
}

/**
 * Creates an organization named `name` with `userId` as its admin. When its slug is taken by one
 * `userId` already runs (a retry whose first answer was lost, or the form sent twice), that one
 * is the answer; a slug someone else holds is refused.
 */
export async function createOrganization(userId: string, name: string): Promise<string> {
  const slug = slugOf(name)

  try {
    const org = await backend((clerk) =>
      clerk.organizations.createOrganization({ name, slug, createdBy: userId }),
    )

    return org.id
  } catch (error) {
    if (clerkErrorCode(error) !== "form_identifier_exists") throw error

    const existing = await backend((clerk) => clerk.organizations.getOrganization({ slug }))
    const mine = (await organizationsOf(userId)).some(
      (org) => org.id === existing.id && org.role === "org:admin",
    )

    if (!mine) throw new Error(`An organization called ${name} already exists.`, { cause: error })

    return existing.id
  }
}

/** Invitations in progress in this server, by organization and address. */
const inviting = new Map<string, Promise<InviteOutcome>>()

/** What inviting someone came to. */
export type InviteOutcome = "invited" | "already-invited" | "member"

/** The pending invitation to `email` in `orgId`, or whether they are a member already. */
async function existingInvite(orgId: string, email: string): Promise<InviteOutcome | undefined> {
  const [pending, members] = await Promise.all([
    backend((clerk) =>
      clerk.organizations.getOrganizationInvitationList({
        organizationId: orgId,
        status: ["pending"],
        limit: 100,
      }),
    ),
    backend((clerk) =>
      clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    ),
  ])

  if (members.data.some((m) => m.publicUserData?.identifier.toLowerCase() === email))
    return "member"
  if (pending.data.some((i) => i.emailAddress.toLowerCase() === email)) return "already-invited"

  return undefined
}

/**
 * Invites `email` to `orgId` once. Each try looks for an invitation (or a membership) the address
 * already has before making one, so a retry after a lost answer never invites twice, and two
 * submits at once wait for each other. Clerk emails the invitation, linking to `redirectUrl`.
 */
export function inviteMember(
  orgId: string,
  inviterUserId: string,
  address: string,
  redirectUrl: string,
): Promise<InviteOutcome> {
  const email = address.trim().toLowerCase()
  const key = `${orgId} ${email}`
  const running = inviting.get(key)

  if (running) return running

  const invite = withRetry(async (): Promise<InviteOutcome> => {
    const existing = await existingInvite(orgId, email)

    if (existing !== undefined) return existing

    const clerk = await clerkClient()

    await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId,
      emailAddress: email,
      role: "org:member",
      redirectUrl,
    })

    return "invited"
  }, retryable).finally(() => inviting.delete(key))

  inviting.set(key, invite)

  return invite
}

/** `orgId` as `userId` sees it, or undefined when they are not a member. */
export async function organizationView(
  userId: string,
  orgId: string,
  reach: Reach = backend,
): Promise<OrganizationView | undefined> {
  const [org, memberships, invitations, inApp] = await Promise.all([
    reach((clerk) => clerk.organizations.getOrganization({ organizationId: orgId })),
    reach((clerk) =>
      clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    ),
    reach((clerk) =>
      clerk.organizations.getOrganizationInvitationList({
        organizationId: orgId,
        status: ["pending"],
        limit: 100,
      }),
    ),
    appMembers(orgId),
  ])
  const mine = memberships.data.find((m) => m.publicUserData?.userId === userId)

  if (mine === undefined) return undefined

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: mine.role,
    members: memberships.data
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((m) => {
        const data = m.publicUserData
        const name = [data?.firstName, data?.lastName].filter(Boolean).join(" ")

        return {
          userId: data?.userId ?? "",
          name: name || (data?.identifier ?? ""),
          email: data?.identifier ?? "",
          role: m.role,
          inApp: inApp.some((row) => row.clerk_user_id === data?.userId),
        }
      }),
    invitations: invitations.data.map((i) => ({ id: i.id, email: i.emailAddress, role: i.role })),
  }
}
