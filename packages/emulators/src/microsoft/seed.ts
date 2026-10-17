import { addEvent, calendars, defaultCalendar } from "./calendar.ts"
import type { GraphState } from "./context.ts"
import { driveOf, ensureFolders, putItem, rootOf } from "./drive.ts"
import type { Address, MailAttachment, MicrosoftUser, Recurrence } from "./entities.ts"
import { graphId } from "./helpers.ts"
import { addMessage, findFolder, type MessageFields, wellKnownFolder } from "./mailbox.ts"

/** A message already in a seeded user's mailbox. */
export interface MicrosoftSeedMessage {
  /** The mailbox owner's address. */
  readonly user: string
  /** A well-known folder name or folder id; the inbox by default. */
  readonly folder?: string
  readonly from?: string | Address
  readonly to?: readonly string[]
  readonly cc?: readonly string[]
  readonly subject: string
  readonly body?: string
  readonly bodyType?: "text" | "html"
  readonly isRead?: boolean
  readonly receivedDateTime?: string
  readonly attachments?: ReadonlyArray<{
    readonly name: string
    readonly contentType?: string
    readonly content: string | Buffer
  }>
}

/** An event already in a seeded user's calendar. Times are UTC instants unless `timeZone` says. */
export interface MicrosoftSeedEvent {
  readonly user: string
  readonly subject: string
  readonly start: string
  readonly end: string
  readonly timeZone?: string
  /** A calendar name; the default calendar when absent. */
  readonly calendar?: string
  readonly body?: string
  readonly location?: string
  readonly isAllDay?: boolean
  readonly showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere"
  readonly attendees?: readonly string[]
  readonly recurrence?: Recurrence
}

/** A file or folder already in a seeded user's OneDrive, by path from the root. */
export type MicrosoftSeedFile = {
  readonly user: string
  readonly path: string
} & ({ readonly content: string | Buffer; readonly mimeType?: string } | { readonly folder: true })

/** The seeded user with `email`; seed data may only name users that exist. */
export function userByEmail(state: GraphState, email: string): MicrosoftUser {
  const user = state
    .microsoft()
    .users.all()
    .find((u) => u.email.toLowerCase() === email.toLowerCase())

  if (!user) throw new Error(`seed data names ${email}, who is not a seeded Microsoft user`)

  return user
}

function asAddress(value: string | Address): Address {
  return typeof value === "string" ? { name: value, address: value } : value
}

function toAddresses(list: readonly string[] | undefined): Address[] {
  return (list ?? []).map(asAddress)
}

function seedAttachment(
  attachment: NonNullable<MicrosoftSeedMessage["attachments"]>[number],
): MailAttachment {
  const bytes = Buffer.from(attachment.content)

  return {
    graphId: graphId("AAMkAGA"),
    name: attachment.name,
    contentType: attachment.contentType ?? "application/octet-stream",
    contentBytes: bytes.toString("base64"),
    size: bytes.length,
    isInline: false,
  }
}

function messageFields(seed: MicrosoftSeedMessage, owner: MicrosoftUser, now: Date): MessageFields {
  const received = seed.receivedDateTime ?? now.toISOString()

  return {
    subject: seed.subject,
    body: seed.body ?? "",
    bodyType: seed.bodyType ?? "html",
    from: seed.from ? asAddress(seed.from) : null,
    to: seed.to ? toAddresses(seed.to) : [{ name: owner.name, address: owner.email }],
    cc: toAddresses(seed.cc),
    isRead: seed.isRead ?? false,
    receivedAt: received,
    sentAt: received,
    attachments: (seed.attachments ?? []).map(seedAttachment),
  }
}

export function seedMessage(state: GraphState, seed: MicrosoftSeedMessage): void {
  const owner = userByEmail(state, seed.user)
  const folder =
    findFolder(state, owner.oid, seed.folder ?? "inbox") ??
    wellKnownFolder(state, owner.oid, "inbox")

  addMessage(state, owner.oid, folder.graphId, messageFields(seed, owner, state.clock()))
}

export function seedEvent(state: GraphState, seed: MicrosoftSeedEvent): void {
  const owner = userByEmail(state, seed.user)
  const calendar =
    calendars(state, owner.oid).find((c) => c.name === seed.calendar) ??
    defaultCalendar(state, owner.oid)

  addEvent(state, owner.oid, calendar.graphId, {
    subject: seed.subject,
    start: new Date(seed.start).toISOString(),
    end: new Date(seed.end).toISOString(),
    timeZone: seed.timeZone ?? "UTC",
    body: seed.body ?? "",
    location: seed.location ?? "",
    isAllDay: seed.isAllDay ?? false,
    showAs: seed.showAs ?? "busy",
    attendees: (seed.attendees ?? []).map((address) => ({
      name: address,
      address,
      type: "required" as const,
    })),
    recurrence: seed.recurrence ?? null,
  })
}

export function seedFile(state: GraphState, seed: MicrosoftSeedFile): void {
  const owner = userByEmail(state, seed.user)
  const names = seed.path.split("/").filter((s) => s !== "")
  const root = rootOf(state, driveOf(state, owner.oid))

  if ("folder" in seed) {
    ensureFolders(state, root, names)

    return
  }

  const folder = ensureFolders(state, root, names.slice(0, -1))

  putItem(
    state,
    folder,
    {
      name: names.at(-1) ?? "file",
      content: Buffer.from(seed.content),
      ...(seed.mimeType && { mimeType: seed.mimeType }),
    },
    "replace",
  )
}
