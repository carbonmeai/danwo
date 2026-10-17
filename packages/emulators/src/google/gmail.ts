import { randomBytes } from "node:crypto"

import type { Context } from "../http.ts"
import type { Clock } from "../store.ts"
import { type Caller, GoogleApiError, notFound, requireAccess } from "./api.ts"
import type { GoogleRouteContext } from "./context.ts"
import type {
  GmailChange,
  GmailLabelRecord,
  GmailMailboxRecord,
  GmailMessageRecord,
  GoogleUser,
} from "./entities.ts"
import { addressesIn, composeMessage, type Composition, headerOf, parseMime } from "./mime.ts"
import { publish, type PushContext } from "./push.ts"
import { googleStore } from "./store.ts"

/**
 * A Gmail mailbox's state changes: every change gets the next history id, is kept in the history
 * that `history.list` reads, and, when the mailbox is watched and the change touches a watched
 * label, is published to the watch's Pub/Sub topic.
 */

/** The labels every mailbox has. */
export const SYSTEM_LABELS = [
  "INBOX",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "CHAT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
] as const

/** Gmail's first history id for a new mailbox; real ones are large and only ever grow. */
const FIRST_HISTORY_ID = 1000

/** A 16-hex-digit id, the shape of Gmail message and thread ids. */
function gmailId(): string {
  return `1${randomBytes(8).toString("hex").slice(1)}`
}

/** The mailbox's counters, created with its system labels on first use. */
export function mailboxOf(push: PushContext, owner: string): GmailMailboxRecord {
  const google = googleStore(push.store)
  const found = google.mailboxes.findOneBy("owner", owner)

  if (found) return found

  for (const labelId of SYSTEM_LABELS)
    google.labels.insert({
      labelId,
      owner,
      name: labelId,
      type: "system",
      messageListVisibility: null,
      labelListVisibility: null,
      color: null,
    })

  return google.mailboxes.insert({
    owner,
    historyId: FIRST_HISTORY_ID,
    floor: FIRST_HISTORY_ID,
    watch: null,
  })
}

/** Whether a change to messages with `labelIds` is one the watch asked to hear about. */
function watched(mailbox: GmailMailboxRecord, labelIds: readonly string[], now: number): boolean {
  const watch = mailbox.watch

  if (!watch || watch.expiration <= now) return false
  if (watch.labelIds.length === 0) return true

  const touches = labelIds.some((labelId) => watch.labelIds.includes(labelId))

  return watch.labelFilterBehavior === "include" ? touches : !touches
}

/** Records one change, gives the message its new history id and tells the watch. */
function recordChange(
  push: PushContext,
  message: GmailMessageRecord,
  change: GmailChange,
  labelIds: readonly string[],
): number {
  const google = googleStore(push.store)
  const mailbox = mailboxOf(push, message.owner)
  const historyId = mailbox.historyId + 1

  google.mailboxes.update(mailbox.id, { historyId })
  google.history.insert({
    owner: message.owner,
    historyId,
    change,
    messageId: message.messageId,
    threadId: message.threadId,
    labelIds: [...labelIds],
  })
  google.messages.update(message.id, { historyId })

  if (watched(mailbox, [...message.labelIds, ...labelIds], push.clock().getTime())) {
    const user = google.users.findOneBy("uid", message.owner)

    publish(push, mailbox.watch?.topicName ?? "", {
      emailAddress: user?.email ?? "",
      historyId: String(historyId),
    })
  }

  return historyId
}

/** One message in `owner`'s mailbox by id, or a 404. */
export function messageOf(push: PushContext, owner: string, messageId: string): GmailMessageRecord {
  const found = googleStore(push.store).messages.findOneBy("messageId", messageId)

  if (!found || found.owner !== owner) throw notFound()

  return found
}

/** The thread a new message belongs to: the one asked for, or the one it replies to. */
function threadFor(push: PushContext, owner: string, raw: string, asked: string | null): string {
  const messages = googleStore(push.store).messages.findBy("owner", owner)

  if (asked && messages.some((message) => message.threadId === asked)) return asked

  const headers = parseMime(raw).headers
  const replyTo = headerOf(headers, "in-reply-to") ?? headerOf(headers, "references") ?? ""
  const parent = messages.find((message) => {
    const id = headerOf(parseMime(message.raw).headers, "message-id")

    return id !== undefined && replyTo.includes(id)
  })

  return parent?.threadId ?? asked ?? ""
}

/** What a new message needs besides its bytes. */
export interface NewMessage {
  readonly labelIds: readonly string[]
  readonly threadId?: string | null
  readonly internalDate?: number
}

/** Adds a message to `owner`'s mailbox and records it in the history. */
export function addMessage(
  push: PushContext,
  owner: string,
  raw: string,
  options: NewMessage,
): GmailMessageRecord {
  const messageId = gmailId()
  const message = googleStore(push.store).messages.insert({
    messageId,
    threadId: threadFor(push, owner, raw, options.threadId ?? null) || messageId,
    owner,
    labelIds: [...new Set(options.labelIds)],
    raw,
    internalDate: options.internalDate ?? push.clock().getTime(),
    historyId: 0,
  })

  recordChange(push, message, "messageAdded", message.labelIds)

  return googleStore(push.store).messages.findOneBy("messageId", messageId) ?? message
}

/** The ids of `owner`'s labels, user and system, by id. */
function labelIdsOf(push: PushContext, owner: string): Set<string> {
  mailboxOf(push, owner)

  return new Set(
    googleStore(push.store)
      .labels.findBy("owner", owner)
      .map((label) => label.labelId),
  )
}

/** Throws Gmail's 400 for a label id the mailbox does not have. */
function checkLabels(push: PushContext, owner: string, labelIds: readonly string[]): void {
  const known = labelIdsOf(push, owner)
  const unknown = labelIds.find((labelId) => !known.has(labelId))

  if (unknown !== undefined)
    throw new GoogleApiError(400, "invalidArgument", `Invalid label: ${unknown}`)
}

/** Adds and removes labels on a message, recording each actual change. */
export function changeLabels(
  push: PushContext,
  message: GmailMessageRecord,
  add: readonly string[],
  remove: readonly string[],
): GmailMessageRecord {
  checkLabels(push, message.owner, [...add, ...remove])

  const added = add.filter((labelId) => !message.labelIds.includes(labelId))
  const removed = remove.filter((labelId) => message.labelIds.includes(labelId))
  const labelIds = [...message.labelIds.filter((labelId) => !removed.includes(labelId)), ...added]
  const messages = googleStore(push.store).messages
  const updated = messages.update(message.id, { labelIds }) ?? message

  if (added.length > 0) recordChange(push, updated, "labelAdded", added)
  if (removed.length > 0) recordChange(push, updated, "labelRemoved", removed)

  return messages.findOneBy("messageId", message.messageId) ?? updated
}

/** Deletes a message for good, recording it in the history. */
export function deleteMessage(push: PushContext, message: GmailMessageRecord): void {
  const google = googleStore(push.store)

  recordChange(push, message, "messageDeleted", [])
  google.messages.delete(message.id)

  for (const draft of google.drafts.all().filter((d) => d.messageId === message.messageId))
    google.drafts.delete(draft.id)
}

/** A sent message gets a `From`, a `Date` and a `Message-ID` when it lacks them. */
function completeHeaders(raw: string, sender: GoogleUser, clock: Clock): string {
  const headers = parseMime(raw).headers
  const missing = [
    ...(headerOf(headers, "from") ? [] : [`From: ${sender.email}`]),
    ...(headerOf(headers, "date")
      ? []
      : [`Date: ${clock().toUTCString().replace("GMT", "+0000")}`]),
    ...(headerOf(headers, "message-id")
      ? []
      : [`Message-ID: <${randomBytes(12).toString("hex")}@mail.gmail.com>`]),
  ]

  return missing.length === 0 ? raw : `${missing.join("\r\n")}\r\n${raw}`
}

/** Every recipient in the To, Cc and Bcc headers. */
function recipientsOf(raw: string): string[] {
  const headers = parseMime(raw).headers

  return ["to", "cc", "bcc"].flatMap((name) => addressesIn(headerOf(headers, name)))
}

/** The message as recipients see it: without its Bcc header. */
function withoutBcc(raw: string): string {
  return raw.replace(/^Bcc:.*(\r?\n[ \t].*)*\r?\n/im, "")
}

/**
 * Sends a message: the sender keeps it under SENT, and every recipient who has an account in the
 * emulator gets a copy in their INBOX, unread.
 */
export function sendMessage(
  push: PushContext,
  sender: GoogleUser,
  raw: string,
  threadId: string | null,
): GmailMessageRecord {
  const complete = completeHeaders(raw, sender, push.clock)
  const sent = addMessage(push, sender.uid, complete, { labelIds: ["SENT"], threadId })
  const users = googleStore(push.store).users

  for (const address of new Set(recipientsOf(complete))) {
    const recipient = users.findOneBy("email", address)

    if (recipient)
      addMessage(push, recipient.uid, withoutBcc(complete), { labelIds: ["INBOX", "UNREAD"] })
  }

  return sent
}

/** Builds and delivers a message to `owner`'s inbox, as if it arrived from outside. */
export function deliverMessage(
  push: PushContext,
  owner: GoogleUser,
  fields: Composition & { readonly labelIds?: readonly string[] },
): GmailMessageRecord {
  const raw = composeMessage(
    {
      ...fields,
      to: fields.to ?? owner.email,
      messageIdHeader: fields.messageIdHeader ?? `<${randomBytes(12).toString("hex")}@danwo.test>`,
    },
    randomBytes(8).toString("hex"),
  )

  return addMessage(push, owner.uid, raw, {
    labelIds: fields.labelIds ?? ["INBOX", "UNREAD"],
    internalDate: (fields.date ?? push.clock()).getTime(),
  })
}

/** A user label, or a 404. */
export function labelOf(push: PushContext, owner: string, labelId: string): GmailLabelRecord {
  mailboxOf(push, owner)

  const found = googleStore(push.store)
    .labels.findBy("owner", owner)
    .find((label) => label.labelId === labelId)

  if (!found) throw notFound()

  return found
}

/** Stops keeping history before now, so older start ids get 404, as Gmail does after a while. */
export function expireHistory(push: PushContext, owner: string): void {
  const mailbox = mailboxOf(push, owner)

  googleStore(push.store).mailboxes.update(mailbox.id, { floor: mailbox.historyId })
}

/** Who owns the mailbox a Gmail call names: `me` or the caller's own address. */
export function mailboxOwner(
  c: Context,
  context: GoogleRouteContext,
  scopes: readonly string[],
): Caller {
  const caller = requireAccess(c, context, scopes)
  const userId = c.req.param("userId")

  if (userId !== "me" && userId.toLowerCase() !== caller.user.email.toLowerCase())
    throw new GoogleApiError(403, "forbidden", `Delegation denied for ${caller.user.email}`)

  mailboxOf(context, caller.user.uid)

  return caller
}
