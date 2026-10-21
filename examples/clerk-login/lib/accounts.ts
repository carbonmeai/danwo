/**
 * The app's own view of who has an account and who belongs to which organization, written from
 * Clerk's webhooks. Every write is keyed by a Clerk id and safe to repeat, so a webhook that
 * arrives twice, late, or out of order leaves the same rows as one that arrived once on time.
 */
import type { OrganizationMembershipJSON, UserJSON } from "@clerk/nextjs/server"

import { broken } from "./bugs.ts"
import { query } from "./db.ts"

/** A user as the app keeps them. */
export interface AppUser {
  readonly clerk_user_id: string
  readonly email: string
  readonly first_name: string | null
  readonly last_name: string | null
  readonly created_at: Date
}

/** A membership as the app keeps it. */
export interface AppMembership {
  readonly clerk_user_id: string
  readonly role: string
}

/** The user's primary email address, or their first one. */
function primaryEmail(user: UserJSON): string {
  const primary = user.email_addresses.find((email) => email.id === user.primary_email_address_id)

  return (primary ?? user.email_addresses[0])?.email_address ?? ""
}

/**
 * Keeps `user` as Clerk last described them: a new row, or the existing row updated, unless the
 * row already holds a newer version (an older webhook that arrived late).
 */
export async function recordUser(user: UserJSON): Promise<void> {
  const values = [user.id, primaryEmail(user), user.first_name, user.last_name, user.updated_at]

  if (broken("no-upsert")) {
    await query(
      `insert into app_users (clerk_user_id, email, first_name, last_name, clerk_updated_at)
       values ($1, $2, $3, $4, $5)`,
      values,
    )

    return
  }

  await query(
    `insert into app_users (clerk_user_id, email, first_name, last_name, clerk_updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (clerk_user_id) do update
       set email = excluded.email, first_name = excluded.first_name,
           last_name = excluded.last_name, clerk_updated_at = excluded.clerk_updated_at
       where app_users.clerk_updated_at <= excluded.clerk_updated_at`,
    values,
  )
}

/** Forgets a deleted user and their memberships. */
export async function removeUser(clerkUserId: string): Promise<void> {
  await query("delete from memberships where clerk_user_id = $1", [clerkUserId])
  await query("delete from app_users where clerk_user_id = $1", [clerkUserId])
}

/** Keeps a membership as Clerk last described it, like `recordUser`. */
export async function recordMembership(membership: OrganizationMembershipJSON): Promise<void> {
  await query(
    `insert into memberships (clerk_membership_id, clerk_org_id, org_name, clerk_user_id, role, clerk_updated_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (clerk_membership_id) do update
       set org_name = excluded.org_name, role = excluded.role,
           clerk_updated_at = excluded.clerk_updated_at
       where memberships.clerk_updated_at <= excluded.clerk_updated_at`,
    [
      membership.id,
      membership.organization.id,
      membership.organization.name,
      membership.public_user_data.user_id,
      membership.role,
      membership.updated_at,
    ],
  )
}

/** Forgets a membership that ended. */
export async function removeMembership(clerkMembershipId: string): Promise<void> {
  await query("delete from memberships where clerk_membership_id = $1", [clerkMembershipId])
}

/** The app's row for a Clerk user, once the webhook has written it. */
export async function appUser(clerkUserId: string): Promise<AppUser | undefined> {
  const [row] = await query<AppUser>(
    `select clerk_user_id, email, first_name, last_name, created_at
       from app_users where clerk_user_id = $1 order by id limit 1`,
    [clerkUserId],
  )

  return row
}

/** The members the app knows an organization has. */
export function appMembers(clerkOrgId: string): Promise<AppMembership[]> {
  return query<AppMembership>(
    "select clerk_user_id, role from memberships where clerk_org_id = $1 order by id",
    [clerkOrgId],
  )
}
