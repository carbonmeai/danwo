/**
 * What happens to a message after the API answered: its status moves on the emulator's clock
 * (queued, then sent, then delivered or undelivered) and each change is POSTed to its status
 * callback; a message to one of the account's numbers is POSTed to that number's SMS URL, and a
 * `<Message>` in the app's TwiML answer is sent back as a reply.
 */
import type { OutboxMessage } from "../outbox.ts"
import type { WebhookAnswer, WebhookEndpoint } from "../webhooks.ts"
import type { TwilioRouteContext } from "./context.ts"
import type { Account, Message, MessageStatus } from "./entities.ts"
import { messageObject } from "./formatters.ts"
import { API_VERSION, rfc2822, twilioSid } from "./helpers.ts"

/** When a message's status changes, counted from the send. */
const SENT_AFTER_MS = 500
const SETTLED_AFTER_MS = 1500

/** What Twilio says when it could not deliver, by its delivery error code. */
const DELIVERY_ERRORS: Readonly<Record<number, string>> = {
  30003: "Unreachable destination handset",
  30005: "Unknown destination handset",
  30006: "Landline or unreachable carrier",
  30008: "Unknown error",
}

/** The topic a status change to `url` is sent under: the callback's path, which stays put between runs. */
function statusTopic(url: string): string {
  return `message.status ${new URL(url).pathname}`
}

/** The topic a message to `number` is sent under. */
function inboundTopic(number: string): string {
  return `message.received ${number}`
}

/** A message the app asked to send, before it is stored. */
export interface Draft {
  readonly account: Account
  readonly from: string
  readonly to: string
  readonly body: string
  readonly media: readonly string[]
  readonly messagingServiceSid: string | null
  readonly statusCallback: string | null
  /** Sent by Verify: the phone gets it, the account's message list does not show it. */
  readonly viaVerify?: boolean
}

/** Twilio's two names for a status, both sent in a callback. */
function statusFields(message: Message): Record<string, string> {
  return {
    AccountSid: message.account_sid,
    ApiVersion: API_VERSION,
    From: message.from,
    To: message.to,
    MessageSid: message.sid,
    SmsSid: message.sid,
    MessageStatus: message.status,
    SmsStatus: message.status,
    ...(message.error_code !== null && { ErrorCode: String(message.error_code) }),
  }
}

/** The fields Twilio POSTs for a message arriving at one of the account's numbers. */
function inboundFields(message: Message): Record<string, string> {
  return {
    AccountSid: message.account_sid,
    ApiVersion: API_VERSION,
    MessageSid: message.sid,
    SmsSid: message.sid,
    SmsMessageSid: message.sid,
    SmsStatus: "received",
    From: message.from,
    To: message.to,
    Body: message.body,
    NumMedia: message.num_media,
    NumSegments: message.num_segments,
  }
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

/** The texts of the `<Message>` verbs in a TwiML answer. */
function twimlReplies(answer: WebhookAnswer): string[] {
  if (!/xml|text\/plain|html/i.test(answer.contentType) && !answer.body.includes("<Response"))
    return []

  return [...answer.body.matchAll(/<Message\b[^>]*>([\s\S]*?)<\/Message>/gi)]
    .map((match) => {
      const inner = match[1] ?? ""

      return (/<Body\b[^>]*>([\s\S]*?)<\/Body>/i.exec(inner)?.[1] ?? inner).trim()
    })
    .map((text) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"))
    .filter((text) => text !== "")
}

/** A message from `from` arriving at the account's number `to`, POSTed to that number's SMS URL. */
export function receiveMessage(
  context: Pick<TwilioRouteContext, "twilio" | "outbox" | "clock">,
  account: Account,
  message: { readonly from: string; readonly to: string; readonly body: string },
): Message {
  const received = context.twilio.messages.add(
    messageObject({
      sid: twilioSid("SM"),
      accountSid: account.id,
      ...message,
      media: [],
      messagingServiceSid: null,
      direction: "inbound",
      status: "received",
      now: context.clock(),
    }),
    { statusCallback: null, failsWith: null, viaVerify: false },
  )

  context.outbox.push(inboundTopic(message.to), form(inboundFields(received)))

  return received
}

export class TwilioMessaging {
  private readonly context: TwilioRouteContext

  constructor(context: TwilioRouteContext) {
    this.context = context
  }

  /** Stores an outbound message as queued and schedules what happens to it next. */
  send(draft: Draft): Message {
    const { twilio, clock } = this.context
    const message = twilio.messages.add(
      messageObject({
        sid: twilioSid("SM"),
        accountSid: draft.account.id,
        from: draft.from,
        to: draft.to,
        body: draft.body,
        media: draft.media,
        messagingServiceSid: draft.messagingServiceSid,
        direction: "outbound-api",
        status: "queued",
        now: clock(),
        trial: draft.account.type === "Trial",
      }),
      {
        statusCallback: draft.statusCallback,
        failsWith: twilio.unreachable.get(draft.to)?.errorCode ?? null,
        viaVerify: draft.viaVerify ?? false,
      },
    )

    this.later(message.sid, SENT_AFTER_MS, (current) => this.becomeSent(current))
    this.later(message.sid, SETTLED_AFTER_MS, (current) => this.settle(current))

    return message
  }

  /** Sends the replies in the app's TwiML answer to an incoming message. */
  answer(message: OutboxMessage, answer: WebhookAnswer): void {
    if (!message.topic.startsWith("message.received ") || typeof message.body !== "string") return

    const incoming = new URLSearchParams(message.body)
    const account = this.context.twilio.accounts.get(incoming.get("AccountSid") ?? "")

    if (account === undefined) return

    for (const text of twimlReplies(answer))
      this.send({
        account,
        from: incoming.get("To") ?? "",
        to: incoming.get("From") ?? "",
        body: text,
        media: [],
        messagingServiceSid: null,
        statusCallback: null,
      })
  }

  /** Runs `step` on the message `sid` after `ms`, unless the message is gone by then (a reset). */
  private later(sid: string, ms: number, step: (message: Message) => void): void {
    this.context.timer.setTimeout(() => {
      const current = this.context.twilio.messages.get(sid)

      if (current) step(current)
    }, ms)
  }

  private becomeSent(message: Message): void {
    const now = rfc2822(this.context.clock())

    this.change(message, { status: "sent", date_sent: now, date_updated: now })
  }

  /** Delivered, or undelivered with the error of an unreachable number. */
  private settle(message: Message): void {
    const fails = this.context.twilio.messages.extra(message.sid)?.failsWith ?? null
    const now = rfc2822(this.context.clock())

    if (fails === null) {
      this.change(message, { status: "delivered", date_updated: now })

      return
    }

    this.change(message, {
      status: "undelivered",
      error_code: fails,
      error_message: DELIVERY_ERRORS[fails] ?? "Message delivery failed",
      date_updated: now,
    })
  }

  private change(message: Message, changes: Partial<Message> & { status: MessageStatus }): void {
    const changed = this.context.twilio.messages.change(message.sid, changes)
    const callback = this.context.twilio.messages.extra(message.sid)?.statusCallback ?? null

    if (changed && callback !== null)
      this.context.outbox.push(statusTopic(callback), form(statusFields(changed)))
  }
}

/** Where status callbacks and incoming messages go, each signed with its account's auth token. */
export function deliveryEndpoints(context: Pick<TwilioRouteContext, "twilio">): WebhookEndpoint[] {
  const { twilio } = context
  const tokenOf = (accountSid: string) => twilio.accounts.get(accountSid)?.authToken ?? ""
  const callbacks = new Map<string, string>()

  for (const message of twilio.messages.all()) {
    const url = twilio.messages.extra(message.sid)?.statusCallback

    if (url) callbacks.set(url, message.account_sid)
  }

  const numbers = twilio.numbers
    .all()
    .filter((number) => number.smsUrl !== null)
    .map((number) => ({
      id: `number ${number.id}`,
      url: number.smsUrl ?? "",
      events: [inboundTopic(number.id)],
      secret: tokenOf(number.accountSid),
      enabled: true,
    }))
  const statuses = [...callbacks].map(([url, accountSid]) => ({
    id: `status ${url}`,
    url,
    events: [statusTopic(url)],
    secret: tokenOf(accountSid),
    enabled: true,
  }))

  return [...numbers, ...statuses]
}
