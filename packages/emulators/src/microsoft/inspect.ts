import type { Emulator } from "../define.ts"
import { calendarView } from "./calendar.ts"
import type { GraphState } from "./context.ts"
import { childrenOf, deleteItem, driveOf, itemAtPath, parentPath, rootOf } from "./drive.ts"
import type { DriveItemRecord, MessageRecord } from "./entities.ts"
import { findFolder, mailFolders } from "./mailbox.ts"
import {
  type MicrosoftSeedEvent,
  type MicrosoftSeedFile,
  type MicrosoftSeedMessage,
  seedEvent,
  seedFile,
  seedMessage,
  userByEmail,
} from "./seed.ts"
import { revokeSessions } from "./sessions.ts"
import { microsoftStore } from "./store.ts"

/** The Graph state behind an emulator, for tests that look at it or change it directly. */
function graphState(emulator: Pick<Emulator, "store" | "outbox">): GraphState {
  return {
    microsoft: () => microsoftStore(emulator.store),
    clock: emulator.store.clock,
    outbox: emulator.outbox,
  }
}

/** A message as a test reads it. */
export interface OutlookMessage {
  readonly id: string
  /** The folder's display name: `Inbox`, `Sent Items`, … */
  readonly folder: string
  readonly subject: string
  readonly from: string | null
  readonly to: readonly string[]
  readonly body: string
  readonly isRead: boolean
  readonly isDraft: boolean
  readonly receivedAt: string
  readonly attachments: ReadonlyArray<{ readonly name: string; readonly size: number }>
}

export interface OutlookMailbox {
  /** Messages newest first; only those in `folder` (a well-known name or id) when given. */
  messages(folder?: string): OutlookMessage[]
  latest(folder?: string): OutlookMessage | undefined
  /** Delivers a new message to this mailbox, as if it had just arrived; returns its id. */
  receive(message: Omit<MicrosoftSeedMessage, "user">): string
}

function asOutlookMessage(state: GraphState, message: MessageRecord): OutlookMessage {
  const folder = state.microsoft().folders.findOneBy("graphId", message.folderId)

  return {
    id: message.graphId,
    folder: folder?.displayName ?? "",
    subject: message.subject,
    from: message.from?.address ?? null,
    to: message.to.map((a) => a.address),
    body: message.body,
    isRead: message.isRead,
    isDraft: message.isDraft,
    receivedAt: message.receivedAt,
    attachments: message.attachments.map((a) => ({ name: a.name, size: a.size })),
  }
}

/** One user's Outlook mailbox in a Microsoft emulator. */
export function outlookMailbox(
  emulator: Pick<Emulator, "store" | "outbox">,
  email: string,
): OutlookMailbox {
  const state = graphState(emulator)

  const messages = (folder?: string) => {
    const user = userByEmail(state, email)
    const wanted = folder === undefined ? undefined : findFolder(state, user.oid, folder)?.graphId

    mailFolders(state, user.oid)

    return state
      .microsoft()
      .messages.findBy("owner", user.oid)
      .filter((m) => folder === undefined || m.folderId === wanted)
      .toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id - a.id)
      .map((m) => asOutlookMessage(state, m))
  }

  return {
    messages,
    latest: (folder) => messages(folder)[0],
    receive(message) {
      seedMessage(state, { ...message, user: email })

      return messages(message.folder ?? "inbox")[0]?.id ?? ""
    },
  }
}

/** An event occurrence as a test reads it. */
export interface CalendarEntry {
  readonly id: string
  readonly subject: string
  readonly start: string
  readonly end: string
  readonly location: string
  readonly attendees: readonly string[]
  readonly showAs: string
}

export interface OutlookCalendar {
  /** Occurrences between two instants, series expanded, earliest first. */
  between(from: string, to: string): CalendarEntry[]
  /** Adds an event, as if the user had just created it in Outlook; returns its id. */
  add(event: Omit<MicrosoftSeedEvent, "user">): string
}

/** One user's Outlook calendar in a Microsoft emulator. */
export function outlookCalendar(
  emulator: Pick<Emulator, "store" | "outbox">,
  email: string,
): OutlookCalendar {
  const state = graphState(emulator)

  return {
    between: (from, to) =>
      calendarView(state, userByEmail(state, email).oid, {
        from: Date.parse(from),
        to: Date.parse(to),
      }).map((o) => ({
        id: o.instanceId ?? o.event.graphId,
        subject: o.event.subject,
        start: o.start,
        end: o.end,
        location: o.event.location,
        attendees: o.event.attendees.map((a) => a.address),
        showAs: o.event.showAs,
      })),
    add(event) {
      seedEvent(state, { ...event, user: email })

      return state.microsoft().events.all().at(-1)?.graphId ?? ""
    },
  }
}

/** A seed entry without its `user`, keeping each variant of a union apart. */
type WithoutUser<T> = T extends unknown ? Omit<T, "user"> : never

/** A drive item as a test reads it. */
export interface DriveEntry {
  /** From the root, e.g. `/Documents/report.pdf`. */
  readonly path: string
  readonly id: string
  readonly folder: boolean
  readonly size: number
}

export interface OneDrive {
  /** Every file and folder, by path. */
  list(): DriveEntry[]
  /** A file's bytes, or `undefined` when nothing is at `path`. */
  read(path: string): Buffer | undefined
  /** Writes a file (or a folder, with `folder: true`), as if the user had just saved it. */
  put(file: WithoutUser<MicrosoftSeedFile>): void
  /** Deletes what is at `path`, as if the user had. */
  remove(path: string): boolean
}

function entryOf(state: GraphState, item: DriveItemRecord): DriveEntry {
  const parent = parentPath(state, item).slice("/drive/root:".length)

  return {
    path: `${parent}/${item.name}`,
    id: item.graphId,
    folder: item.isFolder,
    size: Buffer.from(item.content ?? "", "base64").length,
  }
}

/** One user's OneDrive in a Microsoft emulator. */
export function oneDrive(emulator: Pick<Emulator, "store" | "outbox">, email: string): OneDrive {
  const state = graphState(emulator)
  const root = () => rootOf(state, driveOf(state, userByEmail(state, email).oid))
  const at = (path: string) =>
    itemAtPath(
      state,
      root(),
      path.split("/").filter((s) => s !== ""),
    )
  const walk = (folder: DriveItemRecord): DriveItemRecord[] =>
    childrenOf(state, folder).flatMap((child) => [child, ...walk(child)])

  return {
    list: () => walk(root()).map((item) => entryOf(state, item)),
    read(path) {
      const item = at(path)

      return item && !item.isFolder ? Buffer.from(item.content ?? "", "base64") : undefined
    },
    put: (file) => seedFile(state, { ...file, user: email }),
    remove(path) {
      const item = at(path)

      if (item) deleteItem(state, item)

      return item !== undefined
    },
  }
}

/** A change notification subscription as a test reads it. */
export interface GraphSubscriptionEntry {
  readonly id: string
  readonly resource: string
  readonly notificationUrl: string
  readonly changeTypes: readonly string[]
  readonly clientState: string | null
  readonly expiresAt: string
}

/** The subscriptions apps have made in a Microsoft emulator, live or expired. */
export function graphSubscriptions(emulator: Pick<Emulator, "store">): GraphSubscriptionEntry[] {
  return microsoftStore(emulator.store)
    .subscriptions.all()
    .map((s) => ({
      id: s.graphId,
      resource: s.resource,
      notificationUrl: s.notificationUrl,
      changeTypes: s.changeTypes,
      clientState: s.clientState,
      expiresAt: s.expiresAt,
    }))
}

/**
 * Signs a user out of every app, as when they change their password or an admin revokes their
 * sessions: refresh tokens fail with `invalid_grant` and Graph refuses their access tokens.
 */
export function revokeMicrosoftSessions(emulator: Pick<Emulator, "store">, email: string): number {
  const microsoft = microsoftStore(emulator.store)
  const user = microsoft.users.all().find((u) => u.email.toLowerCase() === email.toLowerCase())

  return user ? revokeSessions(microsoft, user.oid) : 0
}
