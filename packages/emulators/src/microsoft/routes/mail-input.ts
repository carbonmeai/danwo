import type { Context } from "../../http.ts"
import type { MailAttachment } from "../entities.ts"
import { graphId } from "../helpers.ts"
import {
  address,
  addresses,
  asObject,
  flag,
  itemBody,
  type JsonObject,
  list,
  oneOf,
  present,
  text,
} from "../input.ts"
import type { MessageFields } from "../mailbox.ts"
import type { Preferences } from "../outlook-formatters.ts"

const IMPORTANCE = ["low", "normal", "high"] as const

function importance(value: unknown) {
  return oneOf(IMPORTANCE, text(value)?.toLowerCase())
}

/** A `fileAttachment` from a request body. */
export function attachmentInput(value: unknown): MailAttachment | undefined {
  const raw = asObject(value)
  const contentBytes = text(raw.contentBytes)

  if (contentBytes === undefined) return undefined

  return {
    graphId: graphId("AAMkAGA"),
    name: text(raw.name) ?? "attachment",
    contentType: text(raw.contentType) ?? "application/octet-stream",
    contentBytes,
    size: Buffer.from(contentBytes, "base64").length,
    isInline: flag(raw.isInline) ?? false,
  }
}

function recipientFields(raw: JsonObject): MessageFields {
  return present({
    to: raw.toRecipients === undefined ? undefined : addresses(raw.toRecipients),
    cc: raw.ccRecipients === undefined ? undefined : addresses(raw.ccRecipients),
    bcc: raw.bccRecipients === undefined ? undefined : addresses(raw.bccRecipients),
    replyTo: raw.replyTo === undefined ? undefined : addresses(raw.replyTo),
    from: raw.from === undefined ? undefined : address(raw.from),
  })
}

/** The message fields a create or update request sets. */
export function messageInput(raw: JsonObject): MessageFields {
  const content = itemBody(raw.body)
  const attachments = list(raw.attachments)
    .map(attachmentInput)
    .filter((a): a is MailAttachment => a !== undefined)

  return {
    ...recipientFields(raw),
    ...present({
      subject: text(raw.subject),
      body: content?.content,
      bodyType: content?.type,
      isRead: flag(raw.isRead),
      importance: importance(raw.importance),
      categories:
        raw.categories === undefined
          ? undefined
          : list(raw.categories).filter((c): c is string => typeof c === "string"),
      flagged:
        raw.flag === undefined ? undefined : text(asObject(raw.flag).flagStatus) === "flagged",
    }),
    ...(attachments.length > 0 && { attachments }),
  }
}

/** The reader's `Prefer` choices: plain-text bodies and the time zone for event times. */
export function preferences(c: Context): Preferences {
  const prefer = c.req.header("prefer") ?? ""
  const zone = /outlook\.timezone="([^"]+)"/i.exec(prefer)?.[1]

  return {
    textBodies: /outlook\.body-content-type="?text"?/i.test(prefer),
    timeZone: zone ?? "UTC",
  }
}

/** Says which `Prefer` choices were applied, as Graph does. */
export function appliedHeaders(c: Context): Record<string, string> {
  const applied = []
  const chosen = preferences(c)

  if (chosen.textBodies) applied.push('outlook.body-content-type="text"')
  if (chosen.timeZone !== "UTC") applied.push(`outlook.timezone="${chosen.timeZone}"`)

  return applied.length > 0 ? { "preference-applied": applied.join(", ") } : {}
}
