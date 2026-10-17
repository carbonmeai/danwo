import { randomBytes } from "node:crypto"

import type { Context } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { badRequest, jsonBody, notFound } from "./api.ts"
import type { ChannelRecord, ChannelTarget } from "./entities.ts"
import { googleStore } from "./store.ts"

/**
 * Push notifications, both kinds Google uses:
 * - Calendar and Drive `watch` channels: a POST to the app's address with `X-Goog-*` headers saying
 *   which resource changed (`sync` first, then `exists`, `update`, `change` and so on);
 * - Gmail's Pub/Sub topics: each push subscription to the watched topic gets a POST with the
 *   `{ message: { data, messageId, publishTime }, subscription }` envelope.
 * Both go through the emulator's webhook dispatcher, so retries and the fault matrix apply.
 */

const CHANNEL = "channel:"
const SUBSCRIPTION = "pubsub:"

/** What the dispatcher sends for one channel notification; the headers are built from it. */
interface ChannelNotice {
  readonly channelId: string
  readonly resourceId: string
  readonly resourceUri: string
  readonly state: string
  readonly messageNumber: number
  readonly expiration: number
  readonly token: string | null
  readonly changed: string | null
}

/** Where push deps live: the emulator's store, outbox and clock. */
export interface PushContext {
  readonly store: Store
  readonly outbox: Outbox
  readonly clock: Clock
}

/** A week, Calendar's longest channel lifetime. */
const DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

function expirationOf(value: unknown, now: number): number {
  const asked = Number(value)

  return Number.isFinite(asked) && asked > now ? asked : now + DEFAULT_LIFETIME_MS
}

/** Sends `state` on one channel and bumps its message number. */
function notify(push: PushContext, channel: ChannelRecord, state: string, changed?: string): void {
  const google = googleStore(push.store)
  const messageNumber = channel.messageNumber + 1

  google.channels.update(channel.id, { messageNumber })
  push.outbox.push(`${CHANNEL}${channel.channelId}`, {
    channelId: channel.channelId,
    resourceId: channel.resourceId,
    resourceUri: channel.resourceUri,
    state,
    messageNumber,
    expiration: channel.expiration,
    token: channel.token,
    changed: changed ?? null,
  } satisfies ChannelNotice)
}

/** The channel id and address of a valid `watch` body, or the 400 Google answers. */
function checkWatch(push: PushContext, body: Record<string, unknown>) {
  const channelId = typeof body.id === "string" ? body.id : ""
  const address = typeof body.address === "string" ? body.address : ""

  if (!channelId || !address) throw badRequest("Required", "required")
  if (body.type !== "web_hook" && body.type !== "webhook")
    throw badRequest("Push type should be web_hook.", "push.webhookTypeInvalid")
  if (googleStore(push.store).channels.findOneBy("channelId", channelId))
    throw badRequest(`Channel id ${channelId} not unique`, "channelIdNotUnique")

  return { channelId, address }
}

/**
 * Opens a channel from a `watch` request body (`{ id, type, address, token?, expiration? }`) and
 * sends its `sync` message. Answers the API's channel resource.
 */
export function openChannel(
  push: PushContext,
  body: Record<string, unknown>,
  target: ChannelTarget,
  resourceUri: string,
) {
  const google = googleStore(push.store)
  const { channelId, address } = checkWatch(push, body)
  const channel = google.channels.insert({
    channelId,
    resourceId: randomBytes(18).toString("base64url"),
    resourceUri,
    target,
    address,
    token: typeof body.token === "string" ? body.token : null,
    expiration: expirationOf(body.expiration, push.clock().getTime()),
    messageNumber: 0,
  })

  notify(push, channel, "sync")

  return {
    kind: "api#channel",
    id: channel.channelId,
    resourceId: channel.resourceId,
    resourceUri,
    ...(channel.token !== null && { token: channel.token }),
    expiration: String(channel.expiration),
  }
}

/** Sends `state` to every live channel whose target passes `watches`. */
export function notifyChannels(
  push: PushContext,
  watches: (target: ChannelTarget) => boolean,
  state: string,
  changed?: string,
): void {
  const now = push.clock().getTime()

  for (const channel of googleStore(push.store).channels.all())
    if (channel.expiration > now && watches(channel.target)) notify(push, channel, state, changed)
}

/** `channels.stop`: closes a channel by id and resource id. */
export async function stopChannel(c: Context, store: Store): Promise<Response> {
  const { id, resourceId } = await jsonBody(c)
  const channels = googleStore(store).channels
  const channel = channels.findOneBy("channelId", typeof id === "string" ? id : "")

  if (!channel || channel.resourceId !== resourceId)
    throw notFound(`Channel '${String(id)}' not found for project`)
  channels.delete(channel.id)

  return c.body(null, 204)
}

/** Publishes `data` to a Pub/Sub topic: one push per subscription to it. */
export function publish(push: PushContext, topic: string, data: unknown): void {
  const publishTime = push.clock().toISOString()

  for (const subscription of googleStore(push.store).subscriptions.findBy("topic", topic)) {
    const messageId = String(BigInt(`0x${randomBytes(6).toString("hex")}`))

    push.outbox.push(`${SUBSCRIPTION}${subscription.name}`, {
      message: {
        data: Buffer.from(JSON.stringify(data)).toString("base64"),
        messageId,
        message_id: messageId,
        publishTime,
        publish_time: publishTime,
      },
      subscription: subscription.name,
    })
  }
}

/** Every push target: Pub/Sub push subscriptions and live channels. */
export function pushEndpoints(push: PushContext): WebhookEndpoint[] {
  const google = googleStore(push.store)
  const now = push.clock().getTime()
  const subscriptions = google.subscriptions.all().map((subscription) => ({
    id: `${SUBSCRIPTION}${subscription.name}`,
    url: subscription.endpoint,
    events: [`${SUBSCRIPTION}${subscription.name}`],
    secret: "",
    enabled: true,
  }))
  const channels = google.channels
    .all()
    .filter((channel) => channel.expiration > now)
    .map((channel) => ({
      id: `${CHANNEL}${channel.channelId}`,
      url: channel.address,
      events: [`${CHANNEL}${channel.channelId}`],
      secret: channel.token ?? "",
      enabled: true,
    }))

  return [...subscriptions, ...channels]
}

/** The `X-Goog-*` headers of one channel notification. */
function channelHeaders(notice: ChannelNotice): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "x-goog-channel-id": notice.channelId,
    "x-goog-message-number": String(notice.messageNumber),
    "x-goog-resource-id": notice.resourceId,
    "x-goog-resource-state": notice.state,
    "x-goog-resource-uri": notice.resourceUri,
    "x-goog-channel-expiration": new Date(notice.expiration).toUTCString(),
    ...(notice.token !== null && { "x-goog-channel-token": notice.token }),
    ...(notice.changed !== null && { "x-goog-changed": notice.changed }),
  }
}

/** How Google's pushes are retried: a few attempts over a minute. */
export const PUSH_DELIVERY = { retryDelaysMs: [1000, 10_000, 60_000], timeoutMs: 10_000 }

/** The headers of one push: `X-Goog-*` for a channel, plain JSON for a Pub/Sub push. */
export function pushHeaders(endpoint: WebhookEndpoint, body: string): Record<string, string> {
  if (!endpoint.id.startsWith(CHANNEL)) return { "content-type": "application/json" }

  return channelHeaders(JSON.parse(body) as ChannelNotice)
}
