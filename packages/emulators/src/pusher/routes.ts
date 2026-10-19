/**
 * The Channels HTTP API the server SDKs call on `api-<cluster>.pusher.com`: triggering events
 * (one or a batch), channel info and presence users, and ending a user's connections.
 */
import { HttpError } from "../errors.ts"
import type { App, Context } from "../http.ts"
import { asRecord } from "../json.ts"
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

/** The event fields of a trigger body, checked the way Pusher checks them. */
function eventOf(body: Record<string, unknown>): {
  name: string
  data: string
  channels: string[]
  socketId: string | null
  info: string | null
} {
  const name = body["name"]
  const data = body["data"]
  const channels = Array.isArray(body["channels"])
    ? body["channels"]
    : typeof body["channel"] === "string"
      ? [body["channel"]]
      : []

  if (typeof name !== "string" || name === "") throw new HttpError(400, "Missing parameter: name")
  if (data === undefined) throw new HttpError(400, "Missing parameter: data")
  if (channels.length === 0) throw new HttpError(400, "Missing parameter: channels")
  if (channels.length > MAX_CHANNELS)
    throw new HttpError(400, `Too many channels: ${channels.length} > ${MAX_CHANNELS}`)

  const encoded = typeof data === "string" ? data : JSON.stringify(data)

  if (Buffer.byteLength(encoded) > MAX_DATA_BYTES)
    throw new HttpError(
      413,
      `Event data too large: ${Buffer.byteLength(encoded)} > ${MAX_DATA_BYTES} bytes`,
    )

  return {
    name,
    data: encoded,
    channels: channels.filter((channel): channel is string => typeof channel === "string"),
    socketId: typeof body["socket_id"] === "string" ? body["socket_id"] : null,
    info: typeof body["info"] === "string" ? body["info"] : null,
  }
}

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  try {
    return asRecord(JSON.parse(await c.req.text())) ?? {}
  } catch {
    throw new HttpError(400, "Request body is not valid JSON")
  }
}

/** The `info` attributes a channel's answer asks for, for those Pusher can report. */
function channelInfo(
  ctx: PusherRouteContext,
  app: PusherApp,
  channel: string,
  info: string | null,
) {
  const wanted = new Set((info ?? "").split(",").filter((part) => part !== ""))
  const connections = ctx.hub.on(app, channel).length

  return {
    ...(wanted.has("subscription_count") && { subscription_count: connections }),
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
    const event = eventOf(await bodyOf(c))

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
    const batch = (await bodyOf(c))["batch"]

    if (!Array.isArray(batch)) throw new HttpError(400, "Missing parameter: batch")
    if (batch.length > MAX_BATCH)
      throw new HttpError(400, `Batch too large: ${batch.length} > ${MAX_BATCH}`)

    const events = batch.map((item) => eventOf(asRecord(item) ?? {}))

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

    if (info?.includes("user_count") && !prefix.startsWith("presence-"))
      throw new HttpError(
        400,
        "user_count may only be requested for presence channels (filter_by_prefix=presence-)",
      )

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
    const occupied = ctx.hub.on(app, channel).length > 0

    return c.json({ occupied, ...channelInfo(ctx, app, channel, c.req.query("info") ?? null) })
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
