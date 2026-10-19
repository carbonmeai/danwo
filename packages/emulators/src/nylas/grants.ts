/** Grants: an account connected to the application, with its mailbox's folders and its primary calendar. */
import type { NylasCalendar, NylasFolder, NylasGrant, NylasProvider } from "./entities.ts"
import { grantId, hexId, type NylasRouteContext, seconds } from "./helpers.ts"

/** The folders every mailbox starts with, by provider naming. */
const SYSTEM_FOLDERS: readonly { readonly name: string; readonly attribute: string }[] = [
  { name: "INBOX", attribute: "\\Inbox" },
  { name: "SENT", attribute: "\\Sent" },
  { name: "DRAFT", attribute: "\\Drafts" },
  { name: "TRASH", attribute: "\\Trash" },
  { name: "SPAM", attribute: "\\Junk" },
  { name: "STARRED", attribute: "\\Flagged" },
]

/** What a new grant needs: who it is, at which provider, with which scopes. */
export interface GrantInput {
  readonly email: string
  readonly provider?: NylasProvider
  readonly name?: string
  readonly scope?: readonly string[]
  readonly id?: string
  readonly state?: string | null
}

function folderFor(grant: NylasGrant, name: string, attribute: string): NylasFolder {
  return {
    id: name,
    grant_id: grant.id,
    object: "folder",
    name,
    system_folder: true,
    attributes: [attribute],
    parent_id: null,
    background_color: null,
    text_color: null,
    total_count: 0,
    unread_count: 0,
  }
}

function primaryCalendar(grant: NylasGrant): NylasCalendar {
  return {
    id: grant.provider === "google" ? grant.email : `cal_${hexId()}`,
    grant_id: grant.id,
    object: "calendar",
    name: grant.email,
    description: null,
    location: null,
    timezone: "UTC",
    is_primary: true,
    is_owned_by_user: true,
    read_only: false,
    hex_color: "#039be5",
    metadata: {},
  }
}

/**
 * Adds a grant with its system folders and primary calendar. An existing grant for the same email
 * and provider is renewed rather than duplicated, as re-authenticating does.
 */
export function addGrant(
  context: NylasRouteContext,
  input: GrantInput,
): { grant: NylasGrant; created: boolean } {
  const provider = input.provider ?? "google"
  const existing = context.objects.grants.where(
    (grant) => grant.email === input.email && grant.provider === provider,
  )[0]
  const now = seconds(context.clock)

  if (existing) {
    const grant = context.objects.grants.change(existing.id, {
      grant_status: "valid",
      updated_at: now,
      ...(input.scope && { scope: [...input.scope] }),
    })

    return { grant: grant ?? existing, created: false }
  }

  const grant: NylasGrant = {
    id: input.id ?? grantId(),
    provider,
    grant_status: "valid",
    email: input.email,
    name: input.name ?? null,
    scope: [...(input.scope ?? ["email", "calendar", "contacts"])],
    user_agent: null,
    ip: null,
    state: input.state ?? null,
    provider_user_id: hexId(),
    settings: {},
    created_at: now,
    updated_at: now,
  }

  context.objects.grants.add(grant, null)
  for (const folder of SYSTEM_FOLDERS)
    context.objects.folders.add(folderFor(grant, folder.name, folder.attribute), null)
  context.objects.calendars.add(primaryCalendar(grant), null)

  return { grant, created: true }
}

/** The grant whose mailbox `email` is, if the application holds one. */
export function grantForEmail(context: NylasRouteContext, email: string): NylasGrant | undefined {
  const wanted = email.toLowerCase()

  return context.objects.grants.where(
    (grant) => grant.email.toLowerCase() === wanted && grant.grant_status === "valid",
  )[0]
}

/** Removes a grant and everything it holds. */
export function removeGrant(context: NylasRouteContext, grant: NylasGrant): void {
  const { objects } = context
  const owned = (row: { grant_id: string }) => row.grant_id === grant.id

  for (const table of [
    objects.folders,
    objects.messages,
    objects.threads,
    objects.drafts,
    objects.files,
    objects.calendars,
    objects.events,
    objects.contacts,
    objects.configurations,
    objects.tokens,
  ] as const)
    for (const row of table.where(owned)) table.remove(row.id)

  objects.grants.remove(grant.id)
}
