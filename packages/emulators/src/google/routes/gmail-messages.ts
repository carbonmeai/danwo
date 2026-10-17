import type { gmail_v1 } from "googleapis"

import type { Context } from "../../http.ts"
import { badRequest, isRecord, jsonBody, notFound, pageOf, pageSize, queryAll } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import type { GmailMessageRecord } from "../entities.ts"
import { formatOf, messageRef, messageResource, partById } from "../gmail-format.ts"
import { searchMessages } from "../gmail-query.ts"
import {
  addMessage,
  changeLabels,
  deleteMessage,
  mailboxOwner,
  messageOf,
  sendMessage,
} from "../gmail.ts"
import { parseMime } from "../mime.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"
import { readUpload } from "../uploads.ts"

const USER = "/gmail/v1/users/:userId"
const UPLOAD = "/upload/gmail/v1/users/:userId"

/** A list of label ids from a request body field. */
export function labelList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

/** The RFC 2822 message a send, insert or draft request carries, JSON `raw` or uploaded. */
export async function rawMessage(
  c: Context,
): Promise<{ readonly raw: string; readonly body: Record<string, unknown> }> {
  const upload = c.req.path.startsWith("/upload/") ? await readUpload(c) : undefined
  const body = upload ? upload.metadata : await jsonBody(c)
  const wrapped = isRecord(body.message) ? body.message : body
  const encoded = typeof wrapped.raw === "string" ? wrapped.raw : undefined
  const bytes =
    upload?.media ?? (encoded === undefined ? undefined : Buffer.from(encoded, "base64url"))

  if (!bytes || bytes.length === 0)
    throw badRequest(
      "'raw' RFC822 payload message string or uploading message via /upload/* URL required",
      "invalidArgument",
    )

  return { raw: bytes.toString("latin1"), body: wrapped }
}

/** Whether the query itself asks to look in spam or trash. */
function looksInSpamOrTrash(q: string | undefined): boolean {
  return /\bin:(spam|trash|anywhere)\b/i.test(q ?? "")
}

/** The caller's messages that match the list request, newest first. */
export function listedMessages(
  c: Context,
  context: GoogleRouteContext,
  owner: string,
): GmailMessageRecord[] {
  const google = googleStore(context.store)
  const q = c.req.query("q")
  const labelIds = queryAll(c, "labelIds")
  const withSpamTrash = c.req.query("includeSpamTrash") === "true" || looksInSpamOrTrash(q)
  const candidates = google.messages
    .findBy("owner", owner)
    .filter((message) => labelIds.every((labelId) => message.labelIds.includes(labelId)))
    .filter(
      (message) =>
        withSpamTrash || !message.labelIds.some((label) => label === "SPAM" || label === "TRASH"),
    )

  return searchMessages(
    candidates,
    q,
    google.labels.findBy("owner", owner),
    context.clock().getTime(),
  ).toSorted((a, b) => b.internalDate - a.internalDate)
}

/** Profile, messages and attachments. */
export function gmailMessageRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const google = () => googleStore(context.store)

  /** The caller's message named by the path parameter `param`. */
  const pathMessage = (c: Context, scopes: readonly string[], param = "id") => {
    const caller = mailboxOwner(c, context, scopes)

    return messageOf(context, caller.user.uid, c.req.param(param))
  }

  app.get(`${USER}/profile`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailRead)
    const messages = google().messages.findBy("owner", caller.user.uid)
    const mailbox = google().mailboxes.findOneBy("owner", caller.user.uid)

    return c.json({
      emailAddress: caller.user.email,
      messagesTotal: messages.length,
      threadsTotal: new Set(messages.map((message) => message.threadId)).size,
      historyId: String(mailbox?.historyId ?? 0),
    } satisfies gmail_v1.Schema$Profile)
  })

  app.get(`${USER}/messages`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailRead)
    const found = listedMessages(c, context, caller.user.uid)
    const page = pageOf(found, c.req.query("pageToken"), pageSize(c, "maxResults", 100, 500))

    return c.json({
      ...(page.items.length > 0 && { messages: page.items.map(messageRef) }),
      ...(page.next && { nextPageToken: page.next }),
      resultSizeEstimate: found.length,
    } satisfies gmail_v1.Schema$ListMessagesResponse)
  })

  app.get(`${USER}/messages/:id`, (c) => {
    const message = pathMessage(c, SCOPES.gmailRead)

    return c.json(
      messageResource(message, formatOf(c.req.query("format")), queryAll(c, "metadataHeaders")),
    )
  })

  const send = async (c: Context) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailSend)
    const { raw, body } = await rawMessage(c)
    const threadId = typeof body.threadId === "string" ? body.threadId : null

    return c.json(messageResource(sendMessage(context, caller.user, raw, threadId), "minimal"))
  }

  app.post(`${USER}/messages/send`, send)
  app.post(`${UPLOAD}/messages/send`, send)

  const insert = async (c: Context) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailInsert)
    const { raw, body } = await rawMessage(c)
    const date = Date.parse(
      parseMime(raw).headers.find(([name]) => /^date$/i.test(name))?.[1] ?? "",
    )
    const fromHeader = c.req.query("internalDateSource") !== "receivedTime" && Number.isFinite(date)
    const message = addMessage(context, caller.user.uid, raw, {
      labelIds: labelList(body.labelIds),
      threadId: typeof body.threadId === "string" ? body.threadId : null,
      ...(fromHeader && { internalDate: date }),
    })

    return c.json(messageResource(message, "minimal"))
  }

  app.post(`${USER}/messages`, insert)
  app.post(`${UPLOAD}/messages`, insert)
  app.post(`${USER}/messages/import`, insert)
  app.post(`${UPLOAD}/messages/import`, insert)

  app.post(`${USER}/messages/:id/modify`, async (c) => {
    const message = pathMessage(c, SCOPES.gmailModify)
    const body = await jsonBody(c)
    const changed = changeLabels(
      context,
      message,
      labelList(body.addLabelIds),
      labelList(body.removeLabelIds),
    )

    return c.json(messageResource(changed, "minimal"))
  })

  for (const [action, add, remove] of [
    ["trash", ["TRASH"], []],
    ["untrash", [], ["TRASH"]],
  ] as const)
    app.post(`${USER}/messages/:id/${action}`, (c) => {
      const message = pathMessage(c, SCOPES.gmailModify)

      return c.json(messageResource(changeLabels(context, message, add, remove), "minimal"))
    })

  app.delete(`${USER}/messages/:id`, (c) => {
    deleteMessage(context, pathMessage(c, SCOPES.gmailDelete))

    return c.body(null, 204)
  })

  app.post(`${USER}/messages/batchModify`, async (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailModify)
    const body = await jsonBody(c)

    for (const id of labelList(body.ids))
      changeLabels(
        context,
        messageOf(context, caller.user.uid, id),
        labelList(body.addLabelIds),
        labelList(body.removeLabelIds),
      )

    return c.body(null, 204)
  })

  app.post(`${USER}/messages/batchDelete`, async (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailDelete)

    for (const id of labelList((await jsonBody(c)).ids))
      deleteMessage(context, messageOf(context, caller.user.uid, id))

    return c.body(null, 204)
  })

  app.get(`${USER}/messages/:messageId/attachments/:id`, (c) => {
    const message = pathMessage(c, SCOPES.gmailRead, "messageId")
    const [owner = "", partId = ""] = Buffer.from(c.req.param("id"), "base64url")
      .toString("utf8")
      .split(":")
    const part = owner === message.messageId ? partById(parseMime(message.raw), partId) : undefined

    if (!part) throw notFound("Invalid attachment token")

    return c.json({
      attachmentId: c.req.param("id"),
      size: part.body.length,
      data: part.body.toString("base64url"),
    } satisfies gmail_v1.Schema$MessagePartBody)
  })
}
