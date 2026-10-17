import type { Context } from "../../http.ts"
import type { GraphCall } from "../access.ts"
import { userRoute } from "../access.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import type { Address, MessageRecord } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { addresses, asObject, flag, type JsonObject, jsonBody, text } from "../input.ts"
import { copyFields, type MessageFields, sendMessage } from "../mailbox.ts"
import { htmlToText } from "../outlook-formatters.ts"
import { messageInput } from "./mail-input.ts"
import { findMessage, itemNotFound } from "./messages.ts"

function noRecipients(c: Context, context: MicrosoftRouteContext): Response {
  return graphError(c, context.clock, {
    status: 400,
    code: "ErrorInvalidRecipients",
    message:
      "At least one recipient isn't valid., A message can't be sent because it contains no recipients.",
  })
}

function hasRecipients(message: MessageFields): boolean {
  return [...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])].length > 0
}

/** The body of a reply or forward: the comment, then the original underneath. */
function quoted(comment: string, original: MessageRecord): string {
  const from = original.from ? `${original.from.name} <${original.from.address}>` : ""

  return `${comment}<hr><b>From:</b> ${from}<br><b>Subject:</b> ${original.subject}<br><br>${original.bodyType === "html" ? original.body : htmlToText(original.body)}`
}

function replyTargets(original: MessageRecord, call: GraphCall, all: boolean): Address[] {
  const author =
    original.replyTo.length > 0 ? original.replyTo : original.from ? [original.from] : []

  if (!all) return author

  const me = call.user.email.toLowerCase()
  const others = [...original.to, ...original.cc].filter((a) => a.address.toLowerCase() !== me)

  return [...author, ...others]
}

type Respond = (raw: JsonObject, original: MessageRecord, call: GraphCall) => MessageFields

/** A reply to the author, or to everyone on the original when `all`. */
function answer(all: boolean): Respond {
  return (raw, original, call) => ({
    subject: `RE: ${original.subject}`,
    to: replyTargets(original, call, all),
    body: quoted(text(raw.comment) ?? "", original),
    bodyType: "html",
    conversationId: original.conversationId,
  })
}

/** The message a reply, reply-all or forward sends, from the request and the original. */
const RESPONSES: Readonly<Record<"reply" | "replyAll" | "forward", Respond>> = {
  reply: answer(false),
  replyAll: answer(true),
  forward: (raw, original) => ({
    subject: `FW: ${original.subject}`,
    to: addresses(raw.toRecipients),
    body: quoted(text(raw.comment) ?? "", original),
    bodyType: "html",
    conversationId: original.conversationId,
    attachments: original.attachments,
  }),
}

/** Sending: `sendMail`, sending a draft, and replying to or forwarding a message. */
export function sendRoutes(context: MicrosoftRouteContext): void {
  userRoute(context, "post", "/sendMail", "Mail.Send", async (c, call) => {
    const raw = await jsonBody(c)
    const message = messageInput(asObject(raw.message))

    if (!hasRecipients(message)) return noRecipients(c, context)

    sendMessage(context, call.user, message, { saveToSentItems: flag(raw.saveToSentItems) ?? true })

    return c.body(null, 202)
  })

  userRoute(context, "post", "/messages/:id/send", "Mail.Send", (c, call) => {
    const draft = findMessage(call, c.req.param("id"))

    if (!draft) return itemNotFound(c, context)
    if (!draft.isDraft)
      return graphError(c, context.clock, {
        status: 400,
        code: "ErrorInvalidOperation",
        message: "Only drafts can be sent.",
      })
    if (!hasRecipients(draft)) return noRecipients(c, context)

    sendMessage(context, call.user, copyFields(draft), { draft })

    return c.body(null, 202)
  })

  for (const [action, respond] of Object.entries(RESPONSES))
    userRoute(context, "post", `/messages/:id/${action}`, "Mail.Send", async (c, call) => {
      const original = findMessage(call, c.req.param("id"))

      if (!original) return itemNotFound(c, context)

      const reply = respond(await jsonBody(c), original, call)

      if (!hasRecipients(reply)) return noRecipients(c, context)

      sendMessage(context, call.user, reply)

      return c.body(null, 202)
    })
}
