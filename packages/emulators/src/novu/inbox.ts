/**
 * The Inbox API the `@novu/react` and `@novu/js` clients call from the browser: start a session
 * for a subscriber (checked against the environment's application identifier, and its HMAC when
 * that is on), list and count notifications, mark them read, seen or archived, and preferences.
 */
import { createHmac, randomBytes } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import { asRecord } from "../json.ts"
import { type NovuRouteContext, upsertSubscriber } from "./api.ts"
import type { NovuMessage, NovuSubscriber } from "./entities.ts"
import { subscriberNotification } from "./formatters.ts"

const BASE = "/v1/inbox"

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text()

  if (raw === "") return {}

  try {
    return asRecord(JSON.parse(raw)) ?? {}
  } catch {
    throw new HttpError(400, "Request body is not valid JSON")
  }
}

/** The subscriber an Inbox request's session token belongs to. */
function sessionSubscriber(ctx: NovuRouteContext, c: Context): NovuSubscriber {
  const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1]
  const session = token === undefined ? undefined : ctx.objects.sessions.get(token)
  const subscriber =
    session && ctx.objects.subscribers.where((s) => s.subscriber_id === session.subscriber_id)[0]

  if (subscriber === undefined) throw new HttpError(401, "Unauthorized")

  return subscriber
}

/** A query or JSON flag: true, false, or not given. */
function flag(value: unknown): boolean | undefined {
  if (value === "true" || value === true) return true
  if (value === "false" || value === false) return false

  return undefined
}

/** The subscriber's in-app messages, newest first, filtered as the client asked. */
function inboxOf(
  ctx: NovuRouteContext,
  subscriber: NovuSubscriber,
  filter: Record<string, unknown>,
): NovuMessage[] {
  const read = flag(filter["read"])
  const seen = flag(filter["seen"])
  const archived = flag(filter["archived"]) ?? false
  const tags = Array.isArray(filter["tags"]) ? filter["tags"] : []

  return ctx.objects.messages
    .where(
      (m) =>
        m.channel === "in_app" &&
        m.subscriber_id === subscriber.subscriber_id &&
        m.archived === archived &&
        (read === undefined || m.read === read) &&
        (seen === undefined || m.seen === seen) &&
        (tags.length === 0 || tags.some((tag) => m.tags.includes(String(tag)))),
    )
    .toReversed()
}

/** Changes one of the subscriber's notifications and tells their open Inboxes. */
function change(ctx: NovuRouteContext, c: Context, changes: (now: string) => Partial<NovuMessage>) {
  const subscriber = sessionSubscriber(ctx, c)
  const message = ctx.objects.messages.get(c.req.param("id"))

  if (message?.subscriber_id !== subscriber.subscriber_id)
    throw new HttpError(404, "Notification not found")

  const updated =
    ctx.objects.messages.change(message.id, changes(ctx.clock().toISOString())) ?? message

  ctx.realtime.counts(subscriber.subscriber_id)

  return c.json({ data: subscriberNotification(updated, subscriber) })
}

/** Applies `changes` to every listed (or every) notification of the subscriber. */
function changeAll(
  ctx: NovuRouteContext,
  subscriber: NovuSubscriber,
  ids: unknown,
  changes: Partial<NovuMessage>,
): void {
  const only = Array.isArray(ids)
    ? new Set(ids.filter((id): id is string => typeof id === "string"))
    : undefined

  for (const message of ctx.objects.messages.where(
    (m) => m.channel === "in_app" && m.subscriber_id === subscriber.subscriber_id,
  ))
    if (only === undefined || only.has(message.id)) ctx.objects.messages.change(message.id, changes)

  ctx.realtime.counts(subscriber.subscriber_id)
}

function sessionRoute(ctx: NovuRouteContext): void {
  ctx.app.post(`${BASE}/session`, async (c) => {
    const env = ctx.objects.environment()
    const body = await bodyOf(c)

    if (env === undefined || body["applicationIdentifier"] !== env.application_identifier)
      throw new HttpError(400, "Please provide a valid application identifier")

    const fields =
      typeof body["subscriber"] === "string"
        ? { subscriberId: body["subscriber"] }
        : (asRecord(body["subscriber"]) ?? { subscriberId: body["subscriberId"] })
    const subscriberId = typeof fields["subscriberId"] === "string" ? fields["subscriberId"] : ""

    if (
      env.hmac &&
      body["subscriberHash"] !==
        createHmac("sha256", env.api_key).update(subscriberId).digest("hex")
    )
      throw new HttpError(400, "Please provide a valid HMAC hash")

    const subscriber = upsertSubscriber(ctx, fields)
    const token = `nvs_${randomBytes(18).toString("base64url")}`

    ctx.objects.sessions.add({ id: token, subscriber_id: subscriber.subscriber_id }, null)

    return c.json(
      {
        data: {
          token,
          totalUnreadCount: inboxOf(ctx, subscriber, { read: false }).length,
          removeNovuBranding: false,
          isDevelopmentMode: true,
          maxSnoozeDurationHours: 24,
          applicationIdentifier: env.application_identifier,
          contextKeys: [],
        },
      },
      201,
    )
  })
}

function listRoutes(ctx: NovuRouteContext): void {
  const { app } = ctx

  app.get(`${BASE}/notifications`, (c) => {
    const subscriber = sessionSubscriber(ctx, c)
    const url = new URL(c.req.url)
    const filter = {
      read: c.req.query("read"),
      seen: c.req.query("seen"),
      archived: c.req.query("archived"),
      tags: url.searchParams.getAll("tags[]"),
    }
    const limit = Number(c.req.query("limit") ?? "10")
    const offset = Number(c.req.query("offset") ?? "0")
    const all = inboxOf(ctx, subscriber, filter)

    return c.json({
      data: all.slice(offset, offset + limit).map((m) => subscriberNotification(m, subscriber)),
      hasMore: all.length > offset + limit,
      filter: {
        tags: filter.tags,
        read: filter.read === undefined ? undefined : filter.read === "true",
        archived: filter.archived === "true",
        snoozed: false,
      },
    })
  })

  app.get(`${BASE}/notifications/count`, (c) => {
    const subscriber = sessionSubscriber(ctx, c)
    let filters: unknown = []

    try {
      filters = JSON.parse(c.req.query("filters") ?? "[]")
    } catch {
      throw new HttpError(400, "filters must be JSON")
    }

    const list = Array.isArray(filters) ? filters : [filters]

    return c.json({
      data: list.map((filter) => ({
        count: inboxOf(ctx, subscriber, asRecord(filter) ?? {}).length,
        filter: asRecord(filter) ?? {},
      })),
    })
  })

  app.get(`${BASE}/preferences`, (c) => {
    sessionSubscriber(ctx, c)

    return c.json({ data: [] })
  })

  app.get(`${BASE}/preferences/global`, (c) => {
    sessionSubscriber(ctx, c)

    return c.json({
      data: {
        level: "global",
        enabled: true,
        channels: { in_app: true, email: true, sms: true, push: true, chat: true },
      },
    })
  })
}

function changeRoutes(ctx: NovuRouteContext): void {
  const { app } = ctx
  const single: Record<string, (now: string) => Partial<NovuMessage>> = {
    read: (now) => ({ read: true, seen: true, read_at: now }),
    unread: () => ({ read: false, read_at: null }),
    archive: (now) => ({ archived: true, read: true, archived_at: now }),
    unarchive: () => ({ archived: false, archived_at: null }),
    seen: (now) => ({ seen: true, seen_at: now }),
  }

  for (const [action, changes] of Object.entries(single))
    app.patch(`${BASE}/notifications/:id/${action}`, (c) => change(ctx, c, changes))

  app.post(`${BASE}/notifications/read`, (c) => {
    changeAll(ctx, sessionSubscriber(ctx, c), undefined, {
      read: true,
      seen: true,
      read_at: ctx.clock().toISOString(),
    })

    return c.body(null, 204)
  })

  app.post(`${BASE}/notifications/seen`, async (c) => {
    const subscriber = sessionSubscriber(ctx, c)

    changeAll(ctx, subscriber, (await bodyOf(c))["notificationIds"], {
      seen: true,
      seen_at: ctx.clock().toISOString(),
    })

    return c.body(null, 204)
  })

  app.post(`${BASE}/notifications/archive`, (c) => {
    changeAll(ctx, sessionSubscriber(ctx, c), undefined, {
      archived: true,
      archived_at: ctx.clock().toISOString(),
    })

    return c.body(null, 204)
  })

  app.delete(`${BASE}/notifications/:id/delete`, (c) => {
    const subscriber = sessionSubscriber(ctx, c)
    const message = ctx.objects.messages.get(c.req.param("id"))

    if (message?.subscriber_id !== subscriber.subscriber_id)
      throw new HttpError(404, "Notification not found")
    ctx.objects.messages.remove(message.id)
    ctx.realtime.counts(subscriber.subscriber_id)

    return c.body(null, 204)
  })
}

export function inboxRoutes(ctx: NovuRouteContext): void {
  sessionRoute(ctx)
  listRoutes(ctx)
  changeRoutes(ctx)
}
