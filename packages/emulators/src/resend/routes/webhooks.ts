import type {
  CreateWebhookResponseSuccess,
  RemoveWebhookResponseSuccess,
  UpdateWebhookResponseSuccess,
} from "resend"

import type { ResendRouteContext } from "../context.ts"
import { type EventType, isEventType, type Webhook } from "../entities.ts"
import { jsonBody, listOf, newUuid, notFound, resendError, textOf } from "../helpers.ts"
import { resendSigningSecret } from "../signature.ts"

/** `events` when every entry is a Resend event type; `undefined` otherwise. */
function eventList(value: unknown): EventType[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(isEventType) ? value : undefined
}

/** What a webhook update changes. */
function webhookChanges(body: Record<string, unknown>): Partial<Webhook> {
  const endpoint = textOf(body.endpoint)
  const status = body.status === "enabled" || body.status === "disabled" ? body.status : undefined
  const events = eventList(body.events)

  return {
    ...(endpoint && { endpoint }),
    ...(status && { status }),
    ...(events && { events }),
  }
}

/** Webhook endpoints. Deliveries go through the emulator's dispatcher, signed per endpoint. */
export function webhookRoutes({ app, objects, clock }: ResendRouteContext): void {
  const { webhooks } = objects
  const badEvents = "`events` must list Resend webhook event types."

  app.post("/webhooks", async (c) => {
    const body = await jsonBody(c)
    const endpoint = textOf(body.endpoint)
    const events = eventList(body.events)

    if (!endpoint) return resendError(c, 422, "missing_required_field", "Missing `endpoint` field.")
    if (!events) return resendError(c, 422, "validation_error", badEvents)

    const webhook = webhooks.add(
      {
        object: "webhook",
        id: newUuid(),
        created_at: clock().toISOString(),
        status: "enabled",
        endpoint,
        events,
        signing_secret: resendSigningSecret(),
      },
      null,
    )

    return c.json({
      object: "webhook",
      id: webhook.id,
      signing_secret: webhook.signing_secret,
    } satisfies CreateWebhookResponseSuccess)
  })

  app.get("/webhooks", (c) =>
    listOf(
      c,
      webhooks.all().map(({ object: _object, signing_secret: _secret, ...listed }) => listed),
    ),
  )

  app.get("/webhooks/:id", (c) => {
    const webhook = webhooks.get(c.req.param("id"))

    return webhook ? c.json(webhook) : notFound(c, "Webhook")
  })

  app.patch("/webhooks/:id", async (c) => {
    const id = c.req.param("id")

    if (!webhooks.get(id)) return notFound(c, "Webhook")

    const body = await jsonBody(c)

    if (body.events !== undefined && !eventList(body.events))
      return resendError(c, 422, "validation_error", badEvents)

    webhooks.change(id, webhookChanges(body))

    return c.json({ object: "webhook", id } satisfies UpdateWebhookResponseSuccess)
  })

  app.delete("/webhooks/:id", (c) => {
    const id = c.req.param("id")

    if (!webhooks.remove(id)) return notFound(c, "Webhook")

    return c.json({ object: "webhook", id, deleted: true } satisfies RemoveWebhookResponseSuccess)
  })
}
