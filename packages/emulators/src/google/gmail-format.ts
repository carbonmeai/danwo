import type { gmail_v1 } from "googleapis"

import { badRequest } from "./api.ts"
import type { GmailLabelRecord, GmailMessageRecord } from "./entities.ts"
import { bodyText, decodeWords, type MimePart, parseMime } from "./mime.ts"

/** The `format` values Gmail accepts for messages, threads and drafts. */
export type MessageFormat = "full" | "metadata" | "minimal" | "raw"

/** The asked-for format, `full` by default. */
export function formatOf(value: string | undefined): MessageFormat {
  const format = value ?? "full"

  if (format === "full" || format === "metadata" || format === "minimal" || format === "raw")
    return format

  throw badRequest(`Invalid value at 'format' (${format})`, "invalidArgument")
}

/** A header value as Gmail shows it: UTF-8, with encoded words decoded. */
function displayed(value: string): string {
  return decodeWords(Buffer.from(value, "latin1").toString("utf8"))
}

/** The message's text with whitespace collapsed, cut to Gmail's snippet length. */
export function snippetOf(part: MimePart): string {
  const html = bodyText(part, "text/html")?.replace(/<[^>]*>/g, " ")
  const text = bodyText(part, "text/plain") ?? html ?? ""

  return text.replace(/\s+/g, " ").trim().slice(0, 200)
}

/** An opaque id for one attachment part, stable for the message. */
function attachmentId(messageId: string, partId: string): string {
  return Buffer.from(`${messageId}:${partId}`).toString("base64url")
}

function headersOf(part: MimePart, only?: readonly string[]): gmail_v1.Schema$MessagePartHeader[] {
  const wanted = only?.map((name) => name.toLowerCase())

  return part.headers
    .filter(([name]) => !wanted || wanted.length === 0 || wanted.includes(name.toLowerCase()))
    .map(([name, value]) => ({ name, value: displayed(value) }))
}

/** One MIME part in Gmail's payload shape; attachments carry an id instead of their data. */
function payloadOf(part: MimePart, partId: string, messageId: string): gmail_v1.Schema$MessagePart {
  const isAttachment = part.filename !== ""
  const isLeaf = part.parts.length === 0

  return {
    partId,
    mimeType: part.mimeType,
    filename: part.filename,
    headers: headersOf(part),
    body: {
      size: part.body.length,
      ...(isLeaf && isAttachment && { attachmentId: attachmentId(messageId, partId) }),
      ...(isLeaf && !isAttachment && { data: part.body.toString("base64url") }),
    },
    ...(!isLeaf && {
      parts: part.parts.map((child, index) =>
        payloadOf(child, partId === "" ? String(index) : `${partId}.${index}`, messageId),
      ),
    }),
  }
}

/** The leaf part with `partId`, for `attachments.get`. */
export function partById(part: MimePart, partId: string): MimePart | undefined {
  if (partId === "") return part

  const [head = "", ...rest] = partId.split(".")
  const child = part.parts[Number(head)]

  return child && partById(child, rest.join("."))
}

/** A message in the asked-for format. */
export function messageResource(
  message: GmailMessageRecord,
  format: MessageFormat,
  metadataHeaders: readonly string[] = [],
): gmail_v1.Schema$Message {
  const mime = parseMime(message.raw)
  const minimal: gmail_v1.Schema$Message = {
    id: message.messageId,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: snippetOf(mime),
    sizeEstimate: Buffer.byteLength(message.raw, "latin1"),
    historyId: String(message.historyId),
    internalDate: String(message.internalDate),
  }

  switch (format) {
    case "minimal":
      return minimal
    case "raw":
      return { ...minimal, raw: Buffer.from(message.raw, "latin1").toString("base64url") }
    case "metadata":
      return {
        ...minimal,
        payload: { mimeType: mime.mimeType, headers: headersOf(mime, metadataHeaders) },
      }
    default:
      return { ...minimal, payload: payloadOf(mime, "", message.messageId) }
  }
}

/** The id pair lists and history entries use. */
export function messageRef(message: GmailMessageRecord): gmail_v1.Schema$Message {
  return { id: message.messageId, threadId: message.threadId }
}

/** How many threads the messages belong to. */
function threadCount(list: readonly GmailMessageRecord[]): number {
  return new Set(list.map((message) => message.threadId)).size
}

/** Message and thread counts for one label. */
function countsOf(labelId: string, messages: readonly GmailMessageRecord[]) {
  const labelled = messages.filter((message) => message.labelIds.includes(labelId))
  const unread = labelled.filter((message) => message.labelIds.includes("UNREAD"))

  return {
    messagesTotal: labelled.length,
    messagesUnread: unread.length,
    threadsTotal: threadCount(labelled),
    threadsUnread: threadCount(unread),
  }
}

/** A new label, as `labels.create` answers it: without the `type` the other calls report. */
export function createdLabel(label: GmailLabelRecord): gmail_v1.Schema$Label {
  const { type: _type, ...created } = labelResource(label)

  return created
}

/** A label; with the mailbox's messages, also its counts, as `labels.get` answers. */
export function labelResource(
  label: GmailLabelRecord,
  messages?: readonly GmailMessageRecord[],
): gmail_v1.Schema$Label {
  return {
    id: label.labelId,
    name: label.name,
    type: label.type,
    ...(label.messageListVisibility !== null && {
      messageListVisibility: label.messageListVisibility,
    }),
    ...(label.labelListVisibility !== null && { labelListVisibility: label.labelListVisibility }),
    ...(label.color !== null && { color: label.color }),
    ...(messages && countsOf(label.labelId, messages)),
  }
}
