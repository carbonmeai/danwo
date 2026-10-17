import type { StripeRouteContext } from "../context.ts"
import { webhookEndpointObject } from "../formatters.ts"
import {
  badParam,
  flag,
  items,
  listPage,
  mergeMetadata,
  metadataOf,
  newId,
  noSuch,
  readParams,
  text,
  unix,
} from "../helpers.ts"

/** The event names in `enabled_events[]`. */
function eventNames(value: unknown): string[] {
  return items(value).filter((name): name is string => typeof name === "string")
}

/** Webhook endpoints. The signing secret is returned once, on create, as Stripe does. */
export function webhookEndpointRoutes({ app, objects, clock }: StripeRouteContext): void {
  const endpoints = objects.webhookEndpoints

  app.post("/v1/webhook_endpoints", async (c) => {
    const params = await readParams(c)
    const url = text(params.url)
    const events = eventNames(params.enabled_events)

    if (!url) return badParam(c, "url")
    if (events.length === 0) return badParam(c, "enabled_events")

    const secret = `whsec_${newId("x", 32).slice(2)}`
    const endpoint = endpoints.add(
      webhookEndpointObject({
        id: newId("we"),
        created: unix(clock()),
        url,
        events,
        description: text(params.description) ?? null,
        metadata: metadataOf(params.metadata) ?? {},
        apiVersion: text(params.api_version) ?? null,
      }),
      { secret },
    )

    return c.json({ ...endpoint, secret })
  })

  app.get("/v1/webhook_endpoints", (c) => listPage(c, endpoints.all(), "/v1/webhook_endpoints"))

  app.get("/v1/webhook_endpoints/:id", (c) => {
    const id = c.req.param("id")
    const endpoint = endpoints.get(id)

    return endpoint ? c.json(endpoint) : noSuch(c, "webhook endpoint", id)
  })

  app.post("/v1/webhook_endpoints/:id", async (c) => {
    const id = c.req.param("id")
    const current = endpoints.get(id)

    if (!current) return noSuch(c, "webhook endpoint", id)

    const params = await readParams(c)
    const events = eventNames(params.enabled_events)
    const disabled = flag(params.disabled)
    const url = text(params.url)

    return c.json(
      endpoints.change(id, {
        ...(url && { url }),
        ...(events.length > 0 && { enabled_events: events }),
        ...(disabled !== undefined && { status: disabled ? "disabled" : "enabled" }),
        ...(params.description !== undefined && { description: text(params.description) || null }),
        metadata: mergeMetadata(current.metadata, metadataOf(params.metadata)),
      }),
    )
  })

  app.delete("/v1/webhook_endpoints/:id", (c) => {
    const id = c.req.param("id")

    if (!endpoints.remove(id)) return noSuch(c, "webhook endpoint", id)

    return c.json({ id, object: "webhook_endpoint", deleted: true })
  })
}
