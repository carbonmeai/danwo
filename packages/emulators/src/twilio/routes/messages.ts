import type { Context } from "../../http.ts"
import { requireCaller } from "../auth.ts"
import type { TwilioRouteContext } from "../context.ts"
import type { Account, Message } from "../entities.ts"
import type { Draft, TwilioMessaging } from "../events.ts"
import { API_VERSION, boundedInt, formOf, isE164, notFound, twilioError } from "../helpers.ts"

const MESSAGES = `/${API_VERSION}/Accounts/:account/Messages`
/** The longest body Twilio accepts: ten 160-character segments. */
const MAX_BODY = 1600

/** The sid a `/Messages/{sid}.json` path names. */
const sidOf = (c: Context) => c.req.param("file").replace(/\.json$/, "")

/** A refusal: Twilio's error code and message. */
type Problem = readonly [number, string]

function recipientProblem(to: string): Problem | undefined {
  if (to === "") return [21604, "A 'To' phone number is required."]
  if (!isE164(to)) return [21211, `Invalid 'To' Phone Number: ${to}`]

  return undefined
}

/** A send names a number of the account, or a Messaging Service that picks one. */
function senderProblem(
  context: TwilioRouteContext,
  account: Account,
  draft: Omit<Draft, "account">,
): Problem | undefined {
  if (draft.messagingServiceSid !== null) return undefined
  if (draft.from === "") return [21603, "A 'From' phone number is required."]
  if (context.twilio.numbers.get(draft.from)?.accountSid !== account.id)
    return [
      21606,
      `The From phone number ${draft.from} is not a valid, SMS-capable inbound phone number or short code for your account.`,
    ]

  return undefined
}

function contentProblem(draft: Omit<Draft, "account">): Problem | undefined {
  if (draft.body === "" && draft.media.length === 0) return [21602, "Message body is required."]
  if (draft.body.length > MAX_BODY)
    return [21617, "The concatenated message body exceeds the 1600 character limit."]

  return undefined
}

/** Why a send cannot be made; undefined when it can. */
function problemWith(
  context: TwilioRouteContext,
  account: Account,
  draft: Omit<Draft, "account">,
): Problem | undefined {
  return (
    recipientProblem(draft.to) ?? senderProblem(context, account, draft) ?? contentProblem(draft)
  )
}

/** The account's first number, which a Messaging Service sends from in the emulator. */
function serviceSender(context: TwilioRouteContext, account: Account): string {
  return context.twilio.numbers.where((number) => number.accountSid === account.id)[0]?.id ?? ""
}

async function create(c: Context, context: TwilioRouteContext, messaging: TwilioMessaging) {
  const account = requireCaller(c, context.twilio)
  const form = await formOf(c)
  const messagingServiceSid = form.get("MessagingServiceSid")
  const draft = {
    to: form.get("To") ?? "",
    from: form.get("From") ?? "",
    body: form.get("Body") ?? "",
    media: form.getAll("MediaUrl"),
    messagingServiceSid,
    statusCallback: form.get("StatusCallback"),
  }
  const problem = problemWith(context, account, draft)

  if (problem) return twilioError(c, 400, problem[0], problem[1])

  const from = draft.from || serviceSender(context, account)

  return c.json(messaging.send({ ...draft, from, account }), 201)
}

/** Whether `message` was sent on `day` (`YYYY-MM-DD`). */
function sentOn(message: Message, day: string): boolean {
  return message.date_sent !== null && new Date(message.date_sent).toISOString().startsWith(day)
}

/** Whether `message` passes the list's `To`, `From` and `DateSent` filters. */
function passes(c: Context, message: Message): boolean {
  const to = c.req.query("To")
  const from = c.req.query("From")
  const day = c.req.query("DateSent")

  return (
    (to === undefined || message.to === to) &&
    (from === undefined || message.from === from) &&
    (day === undefined || sentOn(message, day))
  )
}

/** The account's own messages that pass the list's filters, newest first. */
function listed(c: Context, context: TwilioRouteContext, account: Account): Message[] {
  const { messages } = context.twilio
  const own = (message: Message) =>
    message.account_sid === account.id && messages.extra(message.sid)?.viaVerify !== true

  return messages.where((message) => own(message) && passes(c, message)).toReversed()
}

/** One page of the list, in the 2010 API's paging shape. */
function list(c: Context, context: TwilioRouteContext): Response {
  const account = requireCaller(c, context.twilio)
  const all = listed(c, context, account)
  const size = boundedInt(c.req.query("PageSize"), 50, 1000)
  const page = Number(c.req.query("Page") ?? 0) || 0
  const start = page * size
  const items = all.slice(start, start + size)
  const base = `/${API_VERSION}/Accounts/${account.id}/Messages.json`
  const uriFor = (n: number) => `${base}?PageSize=${size}&Page=${n}`

  return c.json({
    messages: items,
    start,
    end: start + Math.max(0, items.length - 1),
    page,
    page_size: size,
    uri: uriFor(page),
    first_page_uri: uriFor(0),
    previous_page_uri: page > 0 ? uriFor(page - 1) : null,
    next_page_uri: start + size < all.length ? uriFor(page + 1) : null,
  })
}

/** The account's message `sid`, or a 404 answer. */
function found(c: Context, context: TwilioRouteContext): Message | Response {
  const account = requireCaller(c, context.twilio)
  const message = context.twilio.messages.get(sidOf(c))

  return message?.account_sid === account.id ? message : notFound(c, `/Messages/${sidOf(c)}.json`)
}

/** Sending and reading messages: `/2010-04-01/Accounts/{sid}/Messages`. */
export function messageRoutes(context: TwilioRouteContext, messaging: TwilioMessaging): void {
  const { app } = context

  app.post(`${MESSAGES}.json`, (c) => create(c, context, messaging))
  app.get(`${MESSAGES}.json`, (c) => list(c, context))
  app.get(`${MESSAGES}/:file`, (c) => {
    const message = found(c, context)

    return message instanceof Response ? message : c.json(message)
  })
  app.delete(`${MESSAGES}/:file`, (c) => {
    const message = found(c, context)

    if (message instanceof Response) return message
    context.twilio.messages.remove(message.sid)

    return c.body(null, 204)
  })
}
