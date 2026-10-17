import { randomInt } from "node:crypto"

import type { Context } from "../../http.ts"
import type { SlackRouteContext, SlackState } from "../context.ts"
import type { ResponseUrlRecord } from "../entities.ts"
import { asObject, HOOKS_BASE, nextTs, secretHex, SlackApiError } from "../helpers.ts"
import { requireChannel, teamOf } from "../lookup.ts"
import { botAuthor, checkDraft, type Draft, postMessage } from "../posting.ts"

/** A webhook body: JSON, or a form whose `payload` field holds the JSON. */
async function payloadOf(c: Context): Promise<Record<string, unknown> | undefined> {
  const type = c.req.header("content-type") ?? ""

  try {
    if (/application\/x-www-form-urlencoded/i.test(type)) {
      const payload = (await c.req.parseBody()).payload

      return typeof payload === "string" ? asObject(JSON.parse(payload)) : undefined
    }

    return asObject(JSON.parse(await c.req.text()))
  } catch {
    return undefined
  }
}

/** The message a webhook body describes. */
function draftOf(body: Record<string, unknown>): Draft {
  return {
    text: typeof body.text === "string" ? body.text : "",
    blocks: Array.isArray(body.blocks) ? body.blocks : null,
    attachments: Array.isArray(body.attachments) ? body.attachments : null,
    threadTs: typeof body.thread_ts === "string" ? body.thread_ts : null,
  }
}

/** Runs `post`, answering a refused message as Slack's webhooks do: a 400 and the error as text. */
function attempt(c: Context, post: () => Response): Response {
  try {
    return post()
  } catch (error) {
    if (error instanceof SlackApiError) return c.text(error.error, 400)

    throw error
  }
}

/** An incoming webhook: posts the body into the webhook's channel as the app. */
async function incoming(c: Context, context: SlackRouteContext): Promise<Response> {
  const { slack } = context
  const hook = slack.webhooks.findOneBy("path", c.req.path)

  if (!hook) return c.text("no_service", 404)

  const body = await payloadOf(c)

  if (!body) return c.text("invalid_payload", 400)

  return attempt(c, () => {
    const channel = requireChannel(slack, hook.channel)

    postMessage(context, channel, botAuthor(slack, hook.appId), draftOf(body))

    return c.text("ok")
  })
}

/** How long a `response_url` works, and how many times. */
const RESPONSE_URL_MS = 30 * 60_000
const RESPONSE_URL_USES = 5

/** Replaces or deletes the message the interaction came from. */
function changeOriginal(
  context: SlackRouteContext,
  record: ResponseUrlRecord,
  body: Record<string, unknown>,
) {
  const { slack, events } = context
  const channel = requireChannel(slack, record.channel)
  const original = slack.messages
    .findBy("channel", channel.channelId)
    .find((message) => message.ts === record.messageTs)

  if (!original) throw new SlackApiError("message_not_found")

  if (body.delete_original === true) {
    slack.messages.delete(original.id)
    events.messageChanged(channel, "message_deleted", original, null)

    return
  }

  const draft = draftOf(body)
  const updated =
    slack.messages.update(original.id, {
      text: draft.text,
      blocks: draft.blocks ?? null,
      editedTs: nextTs(context.store),
    }) ?? original

  events.messageChanged(channel, "message_changed", original, updated)
}

/** Answers through a `response_url`: in the channel, ephemerally, or by changing the original. */
function respond(
  context: SlackRouteContext,
  record: ResponseUrlRecord,
  body: Record<string, unknown>,
) {
  const { slack, store } = context
  const channel = requireChannel(slack, record.channel)
  const draft = draftOf(body)
  const changesOriginal = body.replace_original === true || body.delete_original === true

  if (changesOriginal && record.messageTs !== null) return changeOriginal(context, record, body)
  if (body.response_type === "in_channel")
    return void postMessage(context, channel, botAuthor(slack, record.appId), draft)

  checkDraft(channel, draft)
  slack.ephemeral.insert({
    channel: channel.channelId,
    user: record.user,
    ts: nextTs(store),
    text: draft.text,
    blocks: draft.blocks ?? null,
    appId: record.appId,
  })
}

/** A `response_url` from a command or an interaction: up to five answers within 30 minutes. */
async function responseUrl(c: Context, context: SlackRouteContext): Promise<Response> {
  const { slack, clock } = context
  const record = slack.responseUrls.findOneBy("path", c.req.path)
  const live = record && record.uses < RESPONSE_URL_USES && record.expiresAt > clock().getTime()

  if (!record || !live) return c.text("expired_url", 404)

  const body = await payloadOf(c)

  if (!body) return c.text("invalid_payload", 400)
  slack.responseUrls.update(record.id, { uses: record.uses + 1 })

  return attempt(c, () => {
    respond(context, record, body)

    return c.json({ ok: true })
  })
}

/** Issues a `response_url` for a command or an interaction in `channel`. */
export function issueResponseUrl(
  context: SlackState,
  fields: Pick<ResponseUrlRecord, "appId" | "channel" | "user" | "messageTs">,
  kind: "commands" | "actions",
): string {
  const team = teamOf(context.slack).teamId
  const path = `/${kind}/${team}/${String(randomInt(1e12, 1e13))}/${secretHex(12)}`

  context.slack.responseUrls.insert({
    ...fields,
    path,
    uses: 0,
    expiresAt: context.clock().getTime() + RESPONSE_URL_MS,
  })

  return `${HOOKS_BASE}${path}`
}

/** Incoming webhooks and response URLs, on `hooks.slack.com`. */
export function webhookRoutes(context: SlackRouteContext): void {
  context.app.post("/services/:team/:bot/:secret", (c) => incoming(c, context))
  context.app.post("/commands/:team/:id/:secret", (c) => responseUrl(c, context))
  context.app.post("/actions/:team/:id/:secret", (c) => responseUrl(c, context))
}
