import type { Emulator } from "../define.ts"
import { cancelEvent, eventOf, expireSyncTokens, insertEvent, primaryCalendar } from "./calendar.ts"
import { createFile, deleteFile, isRoot } from "./drive.ts"
import type { GmailMessageRecord, GoogleUser } from "./entities.ts"
import { deliverMessage, expireHistory, mailboxOf } from "./gmail.ts"
import { bodyText, type Composition, decodeWords, headerOf, parseMime } from "./mime.ts"
import type { PushContext } from "./push.ts"
import { googleStore } from "./store.ts"
import type { CalendarEvent, DriveFile } from "./views.ts"

/**
 * One message in a Gmail mailbox, as a test reads it: ids and labels, the From, To and Subject
 * headers, the plain and HTML bodies, when Gmail received it, and any other header by name.
 */
export type GmailMessage = Readonly<
  Record<"id" | "threadId" | "from" | "to" | "subject", string> &
    Record<"text" | "html", string | undefined> & { labelIds: readonly string[]; date: Date }
> & { header(name: string): string | undefined }

/**
 * A message to drop into a mailbox, as if it arrived from outside. `labelIds` files it under
 * those labels; INBOX and UNREAD by default.
 */
export type IncomingMail = Omit<Composition, "bcc" | "messageIdHeader" | "references"> & {
  readonly labelIds?: readonly string[]
}

/** What `gmailMailbox(emulator, user)` reads and does: a user's Gmail messages. */
export interface GmailMailbox {
  /** Messages, newest first; only those with `labelId` when given. */
  messages(labelId?: string): GmailMessage[]
  /** What the user sent, newest first. */
  sent(): GmailMessage[]
  /** What is in the inbox, newest first. */
  inbox(): GmailMessage[]
  /** Delivers a message to this mailbox; it shows up in history and on the watch. */
  deliver(mail: IncomingMail): GmailMessage
  /** Forgets history so far, so syncing from an older history id gets Gmail's 404. */
  expireHistory(): void
}

function asGmailMessage(record: GmailMessageRecord): GmailMessage {
  const mime = parseMime(record.raw)

  const header = (name: string) => {
    const value = headerOf(mime.headers, name)

    return value === undefined
      ? undefined
      : decodeWords(Buffer.from(value, "latin1").toString("utf8"))
  }

  return {
    id: record.messageId,
    threadId: record.threadId,
    labelIds: record.labelIds,
    from: header("from") ?? "",
    to: header("to") ?? "",
    subject: header("subject") ?? "",
    text: bodyText(mime, "text/plain"),
    html: bodyText(mime, "text/html"),
    date: new Date(record.internalDate),
    header,
  }
}

/** The account with `email`, or an error naming the seeded accounts. */
function seededUser(emulator: Pick<Emulator, "store">, email: string): GoogleUser {
  const users = googleStore(emulator.store).users
  const user = users.findOneBy("email", email.toLowerCase()) ?? users.findOneBy("email", email)

  if (!user)
    throw new Error(
      `no Google account ${email}; seeded: ${
        users
          .all()
          .map((u) => u.email)
          .join(", ") || "none"
      }`,
    )

  return user
}

/** The push context of a running emulator, for helpers that change state from a test. */
function pushContextOf(emulator: Pick<Emulator, "store" | "outbox">): PushContext {
  return { store: emulator.store, outbox: emulator.outbox, clock: emulator.store.clock }
}

/** Reads and changes `email`'s Gmail mailbox from a test. */
export function gmailMailbox(
  emulator: Pick<Emulator, "store" | "outbox">,
  email: string,
): GmailMailbox {
  const push = pushContextOf(emulator)
  const user = seededUser(emulator, email)

  const messages = (labelId?: string) => {
    mailboxOf(push, user.uid)

    return googleStore(emulator.store)
      .messages.findBy("owner", user.uid)
      .filter((message) => labelId === undefined || message.labelIds.includes(labelId))
      .toSorted((a, b) => b.internalDate - a.internalDate)
      .map(asGmailMessage)
  }

  return {
    messages,
    sent: () => messages("SENT"),
    inbox: () => messages("INBOX"),
    deliver: (mail) => asGmailMessage(deliverMessage(push, user, mail)),
    expireHistory: () => expireHistory(push, user.uid),
  }
}

/**
 * Removes the app's access as the user would from their Google Account: every token `email`
 * holds for `clientId` (or for every client) is revoked, so API calls get 401 and refreshes get
 * `invalid_grant`.
 */
export function revokeGoogleAccess(
  emulator: Pick<Emulator, "store">,
  email: string,
  clientId?: string,
): void {
  const user = seededUser(emulator, email)
  const tokens = googleStore(emulator.store).tokens

  for (const token of tokens.all())
    if (token.user === user.uid && (clientId === undefined || token.clientId === clientId))
      tokens.update(token.id, { revoked: true })
}

/** Reads and changes `email`'s primary calendar from a test. */
export interface GoogleCalendar {
  /** Events on the calendar that are not cancelled, oldest first. */
  events(): CalendarEvent[]
  /** Adds an event as if made elsewhere (another device); watchers are told. */
  add(event: CalendarEvent): CalendarEvent
  /** Cancels an event as if deleted elsewhere. */
  cancel(eventId: string): void
  /** Makes every sync token issued so far get 410 Gone, so the app must sync in full. */
  expireSyncTokens(): void
}

/** A user's Google Calendar in the emulator: read events, and change them as if from elsewhere. */
export function googleCalendar(
  emulator: Pick<Emulator, "store" | "outbox">,
  email: string,
): GoogleCalendar {
  const push = pushContextOf(emulator)
  const user = seededUser(emulator, email)
  const calendar = () => primaryCalendar(push, user)

  return {
    events: () =>
      googleStore(emulator.store)
        .events.findBy("calendarId", calendar().calendarId)
        .map((record) => record.event)
        .filter((event) => event.status !== "cancelled"),
    add: (event) => insertEvent(push, calendar(), user, event).event,
    cancel: (eventId) => cancelEvent(push, calendar(), eventOf(push, calendar(), eventId)),
    expireSyncTokens: () => expireSyncTokens(push, calendar()),
  }
}

/** Reads and changes `email`'s Drive from a test. */
export interface GoogleDrive {
  /** The user's own files (not trashed or deleted), oldest first. */
  files(): DriveFile[]
  /** A file's bytes. */
  read(fileId: string): Buffer | undefined
  /** Adds a file as if uploaded elsewhere; it shows up in the change feed and on watches. */
  add(file: { name: string; mimeType?: string; content?: string | Buffer }): DriveFile
  /** Deletes a file as if removed elsewhere. */
  remove(fileId: string): void
}

/** A user's Google Drive in the emulator: read files, and change them as if from elsewhere. */
export function googleDrive(
  emulator: Pick<Emulator, "store" | "outbox">,
  email: string,
): GoogleDrive {
  const push = pushContextOf(emulator)
  const user = seededUser(emulator, email)
  const files = () => googleStore(emulator.store).files

  return {
    files: () =>
      files()
        .findBy("owner", user.uid)
        .filter((record) => !isRoot(push, record) && record.file.trashed !== true)
        .map((record) => record.file),
    read: (fileId) => {
      const record = files().findOneBy("fileId", fileId)

      return record?.content == null ? undefined : Buffer.from(record.content, "base64")
    },
    add: (file) =>
      createFile(push, user, null, {
        metadata: { name: file.name, ...(file.mimeType && { mimeType: file.mimeType }) },
        ...(file.content !== undefined && { content: Buffer.from(file.content) }),
      }).file,
    remove: (fileId) => {
      const record = files().findOneBy("fileId", fileId)

      if (record) deleteFile(push, record)
    },
  }
}
