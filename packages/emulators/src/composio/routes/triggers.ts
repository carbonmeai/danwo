import type {
  ManageDeleteResponse,
  ManageUpdateResponse,
  TriggerInstanceUpsertResponse,
} from "@composio/client/resources/trigger-instances"
import type {
  WebhookSubscriptionDeleteResponse,
  WebhookSubscriptionListEventTypesResponse,
  WebhookSubscriptionRotateSecretResponse,
} from "@composio/client/resources/webhook-subscriptions"

import type { Context } from "../../http.ts"
import { asRecord, isOneOf } from "../../json.ts"
import { accountForCall } from "../accounts.ts"
import type { ComposioRouteContext } from "../context.ts"
import type { TriggerInstanceRecord, WebhookSubscriptionRecord } from "../entities.ts"
import { EVENT_TYPES } from "../events.ts"
import {
  subscriptionObject,
  TOOLKIT_VERSION,
  triggerInstanceObject,
  triggerTypeObject,
} from "../formatters.ts"
import {
  api,
  ComposioError,
  composioId,
  iso,
  jsonBody,
  keeps,
  newUuid,
  notFound,
  page,
  queryFlag,
  queryList,
  secret,
  textOf,
  textsOf,
  toolkitKey,
} from "../helpers.ts"
import { allTriggerTypes, triggerTypeOf } from "../lookup.ts"

function triggerOf(context: ComposioRouteContext, id: string): TriggerInstanceRecord {
  const trigger = context.objects.triggers.get(id)

  if (!trigger) throw notFound("Trigger instance", id, 1501, "TriggerInstance_NotFound")

  return trigger
}

/** `POST /trigger_instances/{slug}/upsert`: one trigger per type and account, its config replaced. */
async function upsert(context: ComposioRouteContext, c: Context): Promise<Response> {
  const type = triggerTypeOf(context.objects, c.req.param("slug"))

  if (!type) throw notFound("Trigger type", c.req.param("slug"), 1502, "TriggerType_NotFound")

  const body = await jsonBody(c)
  const account = accountForCall(context.objects, type.toolkit, {
    accountId: textOf(body["connected_account_id"]) ?? textOf(body["connectedAuthId"]),
    userId: textOf(body["user_id"]),
  })
  const config = asRecord(body["trigger_config"]) ?? asRecord(body["triggerConfig"]) ?? {}
  const now = iso(context.clock())
  const existing = context.objects.triggers.where(
    (t) => t.triggerName === type.slug && t.accountId === account.id,
  )[0]

  if (existing) {
    context.objects.triggers.change(existing.id, {
      config: { ...config },
      disabledAt: null,
      updatedAt: now,
    })

    return c.json({ trigger_id: existing.id } satisfies TriggerInstanceUpsertResponse)
  }

  const created = context.objects.triggers.add(
    {
      id: composioId("ti"),
      uuid: newUuid(),
      triggerName: type.slug,
      accountId: account.id,
      userId: account.userId,
      config: { ...config },
      version: textOf(body["version"]) ?? TOOLKIT_VERSION,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    },
    null,
  )

  return c.json({ trigger_id: created.id } satisfies TriggerInstanceUpsertResponse)
}

function active(context: ComposioRouteContext, c: Context): Response {
  const accounts = [
    ...queryList(c, "connected_account_ids"),
    ...queryList(c, "connectedAccountIds"),
  ]
  const ids = [...queryList(c, "trigger_ids"), ...queryList(c, "triggerIds")]
  const names = [...queryList(c, "trigger_names"), ...queryList(c, "triggerNames")].map((n) =>
    n.toUpperCase(),
  )
  const configs = [...queryList(c, "auth_config_ids"), ...queryList(c, "authConfigIds")]
  const users = queryList(c, "user_ids")
  const showDisabled = queryFlag(c, "show_disabled") || queryFlag(c, "showDisabled")
  const triggers = context.objects.triggers.where(
    (t) =>
      keeps(accounts, t.accountId) &&
      keeps(ids, t.id) &&
      keeps(names, t.triggerName) &&
      keeps(users, t.userId) &&
      keeps(configs, context.objects.accounts.get(t.accountId)?.authConfigId ?? "") &&
      (showDisabled || t.disabledAt === null),
  )

  return c.json(page(c, triggers.map(triggerInstanceObject)))
}

/** Trigger types and the triggers set up on accounts. */
export function triggerRoutes(context: ComposioRouteContext): void {
  const { objects } = context
  const routes = api(context.app)

  routes.get("/triggers_types", (c) => {
    const toolkits = queryList(c, "toolkit_slugs").map(toolkitKey)
    const types = allTriggerTypes(objects).filter(
      (t) => toolkits.length === 0 || toolkits.includes(t.toolkit),
    )

    return c.json(
      page(
        c,
        types.map((type) => triggerTypeObject(type, objects)),
      ),
    )
  })
  routes.get("/triggers_types/list/enum", (c) =>
    c.json(allTriggerTypes(objects).map((type) => type.slug)),
  )
  routes.get("/triggers_types/:slug", (c) => {
    const type = triggerTypeOf(objects, c.req.param("slug"))

    if (!type) throw notFound("Trigger type", c.req.param("slug"), 1502, "TriggerType_NotFound")

    return c.json(triggerTypeObject(type, objects))
  })
  routes.post("/trigger_instances/:slug/upsert", (c) => upsert(context, c))
  routes.get("/trigger_instances/active", (c) => active(context, c))
  routes.patch("/trigger_instances/manage/:id", async (c) => {
    const trigger = triggerOf(context, c.req.param("id"))
    const status = (await jsonBody(c))["status"]

    if (status === "enable" || status === "disable")
      objects.triggers.change(trigger.id, {
        disabledAt: status === "disable" ? iso(context.clock()) : null,
        updatedAt: iso(context.clock()),
      })

    return c.json({ status: "success" } satisfies ManageUpdateResponse)
  })
  routes.delete("/trigger_instances/manage/:id", (c) => {
    const trigger = triggerOf(context, c.req.param("id"))

    objects.triggers.remove(trigger.id)

    return c.json({ trigger_id: trigger.id } satisfies ManageDeleteResponse)
  })
}

const VERSIONS = ["V1", "V2", "V3"] as const

function subscriptionOf(context: ComposioRouteContext, id: string): WebhookSubscriptionRecord {
  const subscription = context.objects.subscriptions.get(id)

  if (!subscription)
    throw notFound("Webhook subscription", id, 1601, "WebhookSubscription_NotFound")

  return subscription
}

/** The events a subscription body enables, or the default of trigger messages. */
function eventsOf(value: unknown): string[] {
  const events = textsOf(value)

  return events.length > 0 ? events : [EVENT_TYPES.trigger]
}

async function subscribe(context: ComposioRouteContext, c: Context): Promise<Response> {
  if (context.objects.subscriptions.all().length > 0)
    throw new ComposioError(
      409,
      1602,
      "WebhookSubscription_AlreadyExists",
      "The project already has a webhook subscription; update it instead",
    )

  const body = await jsonBody(c)
  const url = textOf(body["webhook_url"])

  if (url === undefined)
    throw new ComposioError(400, 302, "Request_ValidationError", "webhook_url is required")

  const now = iso(context.clock())
  const created = context.objects.subscriptions.add(
    {
      id: composioId("ws"),
      url,
      version: isOneOf(VERSIONS, body["version"]) ? body["version"] : "V3",
      events: eventsOf(body["enabled_events"]),
      secret: secret(),
      createdAt: now,
      updatedAt: now,
    },
    null,
  )

  return c.json(subscriptionObject(created), 201)
}

async function updateSubscription(context: ComposioRouteContext, c: Context): Promise<Response> {
  const subscription = subscriptionOf(context, c.req.param("id"))
  const body = await jsonBody(c)
  const url = textOf(body["webhook_url"])
  const changed = context.objects.subscriptions.change(subscription.id, {
    ...(url !== undefined && { url }),
    ...(Array.isArray(body["enabled_events"]) && { events: eventsOf(body["enabled_events"]) }),
    ...(isOneOf(VERSIONS, body["version"]) && { version: body["version"] }),
    updatedAt: iso(context.clock()),
  })

  return c.json(subscriptionObject(changed ?? subscription))
}

/** The project's webhook subscription: where trigger and account events are delivered. */
export function webhookSubscriptionRoutes(context: ComposioRouteContext): void {
  const { objects } = context
  const routes = api(context.app)

  routes.post("/webhook_subscriptions", (c) => subscribe(context, c))
  routes.get("/webhook_subscriptions", (c) =>
    c.json(page(c, objects.subscriptions.all().map(subscriptionObject))),
  )
  routes.get("/webhook_subscriptions/event_types", (c) =>
    c.json({
      items: [
        {
          event_type: EVENT_TYPES.trigger,
          description: "A trigger fired",
          supported_versions: ["V1", "V2", "V3"],
        },
        {
          event_type: EVENT_TYPES.expired,
          description: "A connected account's credentials expired",
          supported_versions: ["V3"],
        },
      ],
    } satisfies WebhookSubscriptionListEventTypesResponse),
  )
  routes.get("/webhook_subscriptions/:id", (c) =>
    c.json(subscriptionObject(subscriptionOf(context, c.req.param("id")))),
  )
  routes.patch("/webhook_subscriptions/:id", (c) => updateSubscription(context, c))
  routes.post("/webhook_subscriptions/:id/rotate_secret", (c) => {
    const subscription = subscriptionOf(context, c.req.param("id"))
    const changed = objects.subscriptions.change(subscription.id, {
      secret: secret(),
      updatedAt: iso(context.clock()),
    })

    return c.json({
      id: subscription.id,
      secret: changed?.secret ?? subscription.secret,
    } satisfies WebhookSubscriptionRotateSecretResponse)
  })
  routes.delete("/webhook_subscriptions/:id", (c) => {
    const subscription = subscriptionOf(context, c.req.param("id"))

    objects.subscriptions.remove(subscription.id)

    return c.json({ success: true } satisfies WebhookSubscriptionDeleteResponse)
  })
}
