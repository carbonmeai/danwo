/**
 * The Channels HTTP API the server SDKs call on `api-<cluster>.pusher.com`: triggering events
 * (one or a batch), channel info and presence users, and ending a user's connections.
 */
import { HttpError } from "../errors.ts"
import type { App, Context } from "../http.ts"
import { asRecord, jsonObjectOf } from "../json.ts"
import type { Clock } from "../store.ts"
import type { PusherHub } from "./channels.ts"
import type { PusherApp } from "./entities.ts"
import { verifyApiRequest } from "./signature.ts"
import type { PusherStore } from "./store.ts"

/** What the Channels routes work with. */
export interface PusherRouteContext {
  readonly app: App
  readonly objects: PusherStore
  readonly hub: PusherHub
  /** The apps' own time, which `auth_timestamp` is checked against. */
  readonly wallClock: Clock
}

/** Largest event data Pusher accepts, in bytes. */
const MAX_DATA_BYTES = 10_240
/** Most channels one trigger may name. */
const MAX_CHANNELS = 100
/** Most events in one batch. */
const MAX_BATCH = 10

/** The app a request names, after checking its key and signature. */
async function signedApp(c: Context, ctx: PusherRouteContext): Promise<PusherApp> {
  const app = ctx.objects.apps.get(c.req.param("appId"))
  const url = new URL(c.req.url)

  if (app === undefined) throw new HttpError(404, `Unknown app: ${c.req.param("appId")}`)
  if (url.searchParams.get("auth_key") !== app.key) throw new HttpError(401, "Unknown auth_key")

  verifyApiRequest(
    app,
    {
      method: c.req.method,
      path: url.pathname,
      params: url.searchParams,
      body: await c.req.text(),
    },
    ctx.wallClock(),
  )

  return app
}

/** The channels a trigger body names, checked the way Pusher checks them. */
function channelsOf(body: Record<string, unknown>): string[] {
  const listed = Array.isArray(body["channels"]) ? body["channels"] : [body["channel"]]
  const channels = listed.filter((channel): channel is string => typeof channel === "string")

  if (channels.length === 0) throw new HttpError(400, "Missing parameter: channels")
  if (channels.length > MAX_CHANNELS)
    throw new HttpError(400, `Too many channels: ${channels.length} > ${MAX_CHANNELS}`)

  return channels
}

/** A trigger's data as the string clients receive, within Pusher's size limit. */
function encodedData(data: unknown): string {
  if (data === undefined) throw new HttpError(400, "Missing parameter: data")

  const encoded = typeof data === "string" ? data : JSON.stringify(data)
  const bytes = Buffer.byteLength(encoded)

  if (bytes > MAX_DATA_BYTES)
    throw new HttpError(413, `Event data too large: ${bytes} > ${MAX_DATA_BYTES} bytes`)

  return encoded
}

/** `value` when it is a string, else null. */
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** The event fields of a trigger body, checked the way Pusher checks them. */
function eventOf(body: Record<string, unknown>): {
  name: string
  data: string
  channels: string[]
  socketId: string | null
  info: string | null
} {
  const name = body["name"]

  if (typeof name !== "string" || name === "") throw new HttpError(400, "Missing parameter: name")

  const data = encodedData(body["data"])

  return {
    name,
    data,
    channels: channelsOf(body),
    socketId: stringOrNull(body["socket_id"]),
    info: stringOrNull(body["info"]),
  }
}

/** Pusher's answer to `subscription_count` from an app with subscription counting off. */
const COUNTING_OFF =
  "Cannot retrieve the subscription count because subscription counting is not enabled\n"
/** Pusher's answer to `user_count` on one channel that is not a presence channel. */
const USERS_ON_PRESENCE_ONLY =
  "Cannot retrieve the user count unless the channel is a presence channel\n"
/** Pusher's answer to `user_count` on a channel list not limited to presence channels. */
const USERS_NEED_PRESENCE_PREFIX =
  "user_count may only be requested for presence channels - please supply filter_by_prefix begining with presence-\n"

/** The `info` attributes a request names. */
function infoOf(info: string | null): Set<string> {
  return new Set((info ?? "").split(",").filter((part) => part !== ""))
}

/** Refuses `subscription_count` when the app has subscription counting off, as Pusher does. */
function requireCounting(app: PusherApp, info: string | null): void {
  if (infoOf(info).has("subscription_count") && !app.subscription_counting)
    throw new HttpError(400, COUNTING_OFF)
}

/**
 * The `info` attributes a channel's answer asks for, for those Pusher can report; a count the
 * app does not keep is left out.
 */
function channelInfo(
  ctx: PusherRouteContext,
  app: PusherApp,
  channel: string,
  info: string | null,
) {
  const wanted = infoOf(info)
  const connections = ctx.hub.on(app, channel).length

  return {
    ...(wanted.has("subscription_count") &&
      app.subscription_counting && { subscription_count: connections }),
    ...(wanted.has("user_count") &&
      channel.startsWith("presence-") && { user_count: ctx.hub.members(app, channel).length }),
  }
}

/** Publishes one event to its channels and records it. */
function publish(ctx: PusherRouteContext, app: PusherApp, event: ReturnType<typeof eventOf>) {
  for (const channel of event.channels) {
    const reached = ctx.hub.deliver(app, channel, event.name, event.data, event.socketId)

    ctx.hub.record(app, {
      channel,
      name: event.name,
      data: event.data,
      socket_id: event.socketId,
      source: "api",
      user_id: null,
      delivered_to: reached,
    })
  }
}

export function channelRoutes(ctx: PusherRouteContext): void {
  const { app: router } = ctx

  router.post("/apps/:appId/events", async (c) => {
    const app = await signedApp(c, ctx)
    const event = eventOf(await jsonObjectOf(c))

    requireCounting(app, event.info)
    publish(ctx, app, event)

    return c.json(
      event.info === null
        ? {}
        : {
            channels: Object.fromEntries(
              event.channels.map((channel) => [
                channel,
                channelInfo(ctx, app, channel, event.info),
              ]),
            ),
          },
    )
  })

  router.post("/apps/:appId/batch_events", async (c) => {
    const app = await signedApp(c, ctx)
    const batch = (await jsonObjectOf(c))["batch"]

    if (!Array.isArray(batch)) throw new HttpError(400, "Missing parameter: batch")
    if (batch.length > MAX_BATCH)
      throw new HttpError(400, `Batch too large: ${batch.length} > ${MAX_BATCH}`)

    const events = batch.map((item) => eventOf(asRecord(item) ?? {}))

    for (const event of events) requireCounting(app, event.info)
    for (const event of events) publish(ctx, app, event)

    const withInfo = events.some((event) => event.info !== null)

    return c.json(
      withInfo
        ? {
            batch: events.map((event) =>
              channelInfo(ctx, app, event.channels[0] ?? "", event.info),
            ),
          }
        : {},
    )
  })

  router.get("/apps/:appId/channels", async (c) => {
    const app = await signedApp(c, ctx)
    const prefix = c.req.query("filter_by_prefix") ?? ""
    const info = c.req.query("info") ?? null

    if (infoOf(info).has("user_count") && !prefix.startsWith("presence-"))
      throw new HttpError(400, USERS_NEED_PRESENCE_PREFIX)

    const channels = [...ctx.hub.occupied(app).keys()].filter((channel) =>
      channel.startsWith(prefix),
    )

    return c.json({
      channels: Object.fromEntries(
        channels.map((channel) => [channel, channelInfo(ctx, app, channel, info)]),
      ),
    })
  })

  router.get("/apps/:appId/channels/:channel", async (c) => {
    const app = await signedApp(c, ctx)
    const channel = c.req.param("channel")
    const info = c.req.query("info") ?? null
    const occupied = ctx.hub.on(app, channel).length > 0

    requireCounting(app, info)
    if (infoOf(info).has("user_count") && !channel.startsWith("presence-"))
      throw new HttpError(400, USERS_ON_PRESENCE_ONLY)

    return c.json({ occupied, ...channelInfo(ctx, app, channel, info) })
  })

  router.get("/apps/:appId/channels/:channel/users", async (c) => {
    const app = await signedApp(c, ctx)
    const channel = c.req.param("channel")

    if (!channel.startsWith("presence-"))
      throw new HttpError(400, "Users can only be listed for presence channels")

    return c.json({
      users: ctx.hub.members(app, channel).map((member) => ({ id: member.user_id })),
    })
  })

  router.post("/apps/:appId/users/:userId/terminate_connections", async (c) => {
    const app = await signedApp(c, ctx)

    ctx.hub.terminate(app, c.req.param("userId"))

    return c.json({})
  })
}
