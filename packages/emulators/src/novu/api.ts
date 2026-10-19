/**
 * Novu's server API on `api.novu.co`, as `@novu/api` calls it: triggering workflows (one, bulk,
 * broadcast, cancel), subscribers (v2: create, retrieve, patch, delete, search; v1 credentials),
 * topics and their subscriptions, and a subscriber's notifications.
 */
import { HttpError } from "../errors.ts"
import type { App, Context, Middleware } from "../http.ts"
import { asRecord } from "../json.ts"
import type { Clock, DataKey, Store } from "../store.ts"
import type { NovuEngine } from "./engine.ts"
import type { NovuEnvironment, NovuSubscriber } from "./entities.ts"
import {
  subscriberNotification,
  subscriberObject,
  subscriberSummary,
  topicObject,
} from "./formatters.ts"
import type { NovuRealtime } from "./realtime.ts"
import { type NovuStore, objectId } from "./store.ts"

export interface NovuRouteContext {
  readonly app: App
  readonly objects: NovuStore
  readonly clock: Clock
  readonly engine: NovuEngine
  readonly realtime: NovuRealtime
}

/** The environment a request's `Authorization: ApiKey <key>` names. */
export function environmentOf(ctx: NovuRouteContext, c: Context): NovuEnvironment {
  const env = ctx.objects.environment()
  const key = (c.req.header("authorization") ?? "")
    .replace(/^ApiKey\s+/i, "")
    .replace(/^Bearer\s+/i, "")

  if (env === undefined || key !== env.api_key) throw new HttpError(401, "API Key not found")

  return env
}

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  try {
    return asRecord(JSON.parse(await c.req.text())) ?? {}
  } catch {
    throw new HttpError(400, "Request body is not valid JSON")
  }
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

/** Creates or updates a subscriber from the fields a request gives. */
export function upsertSubscriber(
  ctx: NovuRouteContext,
  fields: Record<string, unknown>,
): NovuSubscriber {
  const subscriberId = text(fields["subscriberId"])

  if (subscriberId === null || subscriberId === "")
    throw new HttpError(400, "subscriberId must be a string")

  const now = ctx.clock().toISOString()
  const existing = ctx.objects.subscribers.where((s) => s.subscriber_id === subscriberId)[0]
  const changes = {
    ...("firstName" in fields && { first_name: text(fields["firstName"]) }),
    ...("lastName" in fields && { last_name: text(fields["lastName"]) }),
    ...("email" in fields && { email: text(fields["email"]) }),
    ...("phone" in fields && { phone: text(fields["phone"]) }),
    ...("avatar" in fields && { avatar: text(fields["avatar"]) }),
    ...("locale" in fields && { locale: text(fields["locale"]) }),
    ...("timezone" in fields && { timezone: text(fields["timezone"]) }),
    ...("data" in fields && { data: asRecord(fields["data"]) ?? null }),
  }

  if (existing)
    return ctx.objects.subscribers.change(existing.id, { ...changes, updated: now }) ?? existing

  return ctx.objects.subscribers.add(
    {
      id: objectId(),
      subscriber_id: subscriberId,
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      avatar: null,
      locale: null,
      timezone: null,
      data: null,
      channels: [],
      created: now,
      updated: now,
      ...changes,
    },
    null,
  )
}

function subscriberById(ctx: NovuRouteContext, subscriberId: string): NovuSubscriber {
  const found = ctx.objects.subscribers.where((s) => s.subscriber_id === subscriberId)[0]

  if (found === undefined) throw new HttpError(404, `Subscriber with id: ${subscriberId} not found`)

  return found
}

/** The subscribers a trigger's `to` names: ids, subscriber objects (upserted) and topics. */
function recipientsOf(ctx: NovuRouteContext, to: unknown): NovuSubscriber[] {
  const entries = Array.isArray(to) ? to : [to]
  const found = new Map<string, NovuSubscriber>()

  for (const entry of entries) {
    if (typeof entry === "string") {
      const subscriber = upsertSubscriber(ctx, { subscriberId: entry })

      found.set(subscriber.subscriber_id, subscriber)
      continue
    }

    const fields = asRecord(entry) ?? {}

    if (fields["type"] === "Topic" && typeof fields["topicKey"] === "string") {
      const topic = ctx.objects.topics.where((t) => t.key === fields["topicKey"])[0]

      for (const id of topic?.subscribers ?? []) found.set(id, subscriberById(ctx, id))
      continue
    }

    const subscriber = upsertSubscriber(ctx, fields)

    found.set(subscriber.subscriber_id, subscriber)
  }

  return [...found.values()]
}

/** Triggers one event; the workflow runs in the background, as Novu queues it. */
function trigger(ctx: NovuRouteContext, env: NovuEnvironment, body: Record<string, unknown>) {
  const name = text(body["name"]) ?? text(body["workflowId"])

  if (name === null) throw new HttpError(400, "name must be a string")

  const transactionId = text(body["transactionId"]) ?? objectId()
  const recipients = recipientsOf(ctx, body["to"])

  if (recipients.length === 0)
    return {
      acknowledged: true,
      status: "invalid_recipients",
      transactionId,
      error: ["No recipients"],
    }

  if (ctx.objects.workflows.get(name) === undefined && env.bridge_url === null)
    return {
      acknowledged: true,
      status: "trigger_not_active",
      transactionId,
      error: [`Workflow ${name} is not active`],
    }

  ctx.engine.start(env, name, recipients, asRecord(body["payload"]) ?? {}, transactionId)

  return { acknowledged: true, status: "processed", transactionId }
}

function eventRoutes(ctx: NovuRouteContext): void {
  const { app } = ctx

  app.post("/v1/events/trigger", async (c) =>
    c.json({ data: trigger(ctx, environmentOf(ctx, c), await bodyOf(c)) }, 201),
  )

  app.post("/v1/events/trigger/bulk", async (c) => {
    const env = environmentOf(ctx, c)
    const events = (await bodyOf(c))["events"]

    if (!Array.isArray(events)) throw new HttpError(400, "events must be an array")

    return c.json({ data: events.map((event) => trigger(ctx, env, asRecord(event) ?? {})) }, 201)
  })

  app.post("/v1/events/trigger/broadcast", async (c) => {
    const env = environmentOf(ctx, c)
    const body = await bodyOf(c)

    return c.json(
      {
        data: trigger(ctx, env, {
          ...body,
          to: ctx.objects.subscribers.all().map((s) => s.subscriber_id),
        }),
      },
      201,
    )
  })

  app.delete("/v1/events/trigger/:transactionId", (c) => {
    environmentOf(ctx, c)

    return c.json({ data: ctx.engine.cancel(c.req.param("transactionId")) })
  })
}

function subscriberRoutes(ctx: NovuRouteContext): void {
  const { app } = ctx

  app.post("/v2/subscribers", async (c) => {
    const env = environmentOf(ctx, c)

    return c.json(subscriberObject(env, upsertSubscriber(ctx, await bodyOf(c))), 201)
  })

  app.get("/v2/subscribers", (c) => {
    const env = environmentOf(ctx, c)
    const limit = Number(c.req.query("limit") ?? "10")
    const matches = ctx.objects.subscribers.where(
      (s) =>
        (c.req.query("email") === undefined || s.email === c.req.query("email")) &&
        (c.req.query("phone") === undefined || s.phone === c.req.query("phone")) &&
        (c.req.query("subscriberId") === undefined ||
          s.subscriber_id === c.req.query("subscriberId")),
    )

    return c.json({
      data: matches.slice(0, limit).map((s) => subscriberObject(env, s)),
      next: null,
      previous: null,
      totalCount: matches.length,
      totalCountCapped: false,
    })
  })

  app.get("/v2/subscribers/:subscriberId", (c) =>
    c.json(
      subscriberObject(environmentOf(ctx, c), subscriberById(ctx, c.req.param("subscriberId"))),
    ),
  )

  app.patch("/v2/subscribers/:subscriberId", async (c) => {
    const env = environmentOf(ctx, c)

    subscriberById(ctx, c.req.param("subscriberId"))

    return c.json(
      subscriberObject(
        env,
        upsertSubscriber(ctx, { ...(await bodyOf(c)), subscriberId: c.req.param("subscriberId") }),
      ),
    )
  })

  app.delete("/v2/subscribers/:subscriberId", (c) => {
    environmentOf(ctx, c)
    ctx.objects.subscribers.remove(subscriberById(ctx, c.req.param("subscriberId")).id)

    return c.json({ acknowledged: true, status: "deleted" })
  })

  app.put("/v1/subscribers/:subscriberId/credentials", async (c) => {
    const env = environmentOf(ctx, c)
    const subscriber = subscriberById(ctx, c.req.param("subscriberId"))
    const body = await bodyOf(c)
    const providerId = text(body["providerId"])

    if (providerId === null) throw new HttpError(400, "providerId must be a string")

    const channels = [
      ...subscriber.channels.filter((channel) => channel.providerId !== providerId),
      {
        providerId,
        ...(text(body["integrationIdentifier"]) && {
          integrationIdentifier: text(body["integrationIdentifier"]) ?? "",
        }),
        credentials: asRecord(body["credentials"]) ?? {},
      },
    ]

    return c.json({
      data: subscriberObject(
        env,
        ctx.objects.subscribers.change(subscriber.id, { channels }) ?? subscriber,
      ),
    })
  })

  app.get("/v2/subscribers/:subscriberId/notifications", (c) => {
    environmentOf(ctx, c)

    const subscriber = subscriberById(ctx, c.req.param("subscriberId"))
    const limit = Number(c.req.query("limit") ?? "10")
    const inbox = ctx.objects.messages
      .where(
        (m) =>
          m.channel === "in_app" && m.subscriber_id === subscriber.subscriber_id && !m.archived,
      )
      .toReversed()

    return c.json({
      data: inbox.slice(0, limit).map((m) => subscriberNotification(m, subscriber)),
      hasMore: inbox.length > limit,
      filter: {},
    })
  })
}

function topicRoutes(ctx: NovuRouteContext): void {
  const { app } = ctx

  const topicByKey = (key: string) => {
    const found = ctx.objects.topics.where((t) => t.key === key)[0]

    if (found === undefined) throw new HttpError(404, `Topic with key ${key} not found`)

    return found
  }

  app.post("/v2/topics", async (c) => {
    environmentOf(ctx, c)

    const body = await bodyOf(c)
    const key = text(body["key"])

    if (key === null) throw new HttpError(400, "key must be a string")

    const now = ctx.clock().toISOString()
    const existing = ctx.objects.topics.where((t) => t.key === key)[0]
    const topic = existing
      ? (ctx.objects.topics.change(existing.id, {
          name: text(body["name"]) ?? existing.name,
          updated: now,
        }) ?? existing)
      : ctx.objects.topics.add(
          {
            id: objectId(),
            key,
            name: text(body["name"]),
            subscribers: [],
            created: now,
            updated: now,
          },
          null,
        )

    return c.json(topicObject(topic), existing ? 200 : 201)
  })

  app.get("/v2/topics/:topicKey", (c) => {
    environmentOf(ctx, c)

    return c.json(topicObject(topicByKey(c.req.param("topicKey"))))
  })

  const subscriptionOf = (topic: ReturnType<typeof topicByKey>, subscriber: NovuSubscriber) => ({
    _id: `${topic.id}${subscriber.id}`.slice(0, 24),
    identifier: `tk_${topic.key}:si_${subscriber.subscriber_id}`,
    topic: { _id: topic.id, key: topic.key, ...(topic.name !== null && { name: topic.name }) },
    subscriber: subscriberSummary(subscriber),
    createdAt: topic.created,
    updatedAt: topic.updated,
  })

  app.post("/v2/topics/:topicKey/subscriptions", async (c) => {
    environmentOf(ctx, c)

    const topic = topicByKey(c.req.param("topicKey"))
    const body = await bodyOf(c)
    const listed = Array.isArray(body["subscriptions"])
      ? body["subscriptions"]
      : Array.isArray(body["subscriberIds"])
        ? body["subscriberIds"]
        : []
    const ids = listed.flatMap((entry) => {
      const id = typeof entry === "string" ? entry : text(asRecord(entry)?.["subscriberId"])

      return id === null ? [] : [id]
    })
    const subscribers = ids.map((id) => subscriberById(ctx, id))
    const updated =
      ctx.objects.topics.change(topic.id, {
        subscribers: [...new Set([...topic.subscribers, ...ids])],
      }) ?? topic

    return c.json(
      {
        data: subscribers.map((s) => subscriptionOf(updated, s)),
        meta: { totalCount: ids.length, successful: ids.length, failed: 0 },
      },
      201,
    )
  })

  app.get("/v2/topics/:topicKey/subscriptions", (c) => {
    environmentOf(ctx, c)

    const topic = topicByKey(c.req.param("topicKey"))
    const subscribers = topic.subscribers.map((id) => subscriberById(ctx, id))

    return c.json({
      data: subscribers.map((s) => ({ ...subscriptionOf(topic, s), contextKeys: [] })),
      next: null,
      previous: null,
      totalCount: subscribers.length,
      totalCountCapped: false,
    })
  })

  app.delete("/v2/topics/:topicKey/subscriptions", async (c) => {
    environmentOf(ctx, c)

    const topic = topicByKey(c.req.param("topicKey"))
    const body = await bodyOf(c)
    const listed = Array.isArray(body["subscriptions"])
      ? body["subscriptions"]
      : Array.isArray(body["subscriberIds"])
        ? body["subscriberIds"]
        : []
    const ids = listed.flatMap((entry) => {
      const id = typeof entry === "string" ? entry : text(asRecord(entry)?.["subscriberId"])

      return id === null ? [] : [id]
    })
    const removed = ids.filter((id) => topic.subscribers.includes(id))

    ctx.objects.topics.change(topic.id, {
      subscribers: topic.subscribers.filter((id) => !ids.includes(id)),
    })

    return c.json({
      data: removed.map((id) => subscriptionOf(topic, subscriberById(ctx, id))),
      meta: {
        totalCount: ids.length,
        successful: removed.length,
        failed: ids.length - removed.length,
      },
    })
  })
}

/** What one idempotency key remembers: the request it came with and the answer it got. */
interface Remembered {
  readonly request: string
  readonly status: number
  readonly body: string
  readonly at: number
}

const IDEMPOTENCY: DataKey<Map<string, Remembered>> = { name: "novu.idempotency" }
const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000

/**
 * Novu answers a write it has seen under the same `idempotency-key` (which `@novu/api` sends on
 * every request, and keeps across its retries) with the first answer, marked
 * `idempotency-replayed`, so a retry after a lost answer triggers a workflow once. The same key
 * with a different request is refused.
 */
function idempotency(ctx: NovuRouteContext, store: Store): Middleware {
  return async (c, next) => {
    const key = c.req.header("idempotency-key")

    if (key === undefined || c.req.method === "GET" || c.req.path.startsWith("/v1/inbox/"))
      return next()

    const memory = store.getData(IDEMPOTENCY) ?? new Map<string, Remembered>()
    const request = `${c.req.method} ${c.req.path} ${await c.req.text()}`
    const now = ctx.clock().getTime()
    const earlier = memory.get(key)

    if (earlier && now - earlier.at < KEY_LIFETIME_MS) {
      if (earlier.request !== request)
        throw new HttpError(422, `Request with key "${key}" is being reused for a different body`)

      return c.body(earlier.body, earlier.status, {
        "content-type": "application/json",
        "idempotency-key": key,
        "idempotency-replayed": "true",
      })
    }

    const response = await next()
    const body = await response.clone().text()

    if (response.status < 500)
      store.setData(
        IDEMPOTENCY,
        new Map(memory).set(key, { request, status: response.status, body, at: now }),
      )

    return response
  }
}

export function apiRoutes(ctx: NovuRouteContext, store: Store): void {
  ctx.app.use(idempotency(ctx, store))
  eventRoutes(ctx)
  subscriberRoutes(ctx)
  topicRoutes(ctx)
}
