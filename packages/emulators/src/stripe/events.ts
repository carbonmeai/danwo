import type Stripe from "stripe"

import type { App } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Collection, Entity, Store } from "../store.ts"
import { listPage, newId, noSuch, unix } from "./helpers.ts"
import { currentRequest, type StripeRequest } from "./requests.ts"
import type { StripeStore } from "./store.ts"

/** The API version events are rendered with: the one the `stripe` SDK we test against pins. */
export const STRIPE_API_VERSION = "2026-09-30.endive"

/** An event as Stripe sends and serves it. */
export interface StripeEvent {
  id: string
  object: "event"
  api_version: string
  created: number
  data: { object: object }
  livemode: false
  pending_webhooks: number
  request: { id: string | null; idempotency_key: string | null }
  type: string
}

/**
 * The call an event came from, as the event shows it. Events the emulator raises on its own, such
 * as a settlement on the clock, came from no call and show nulls.
 */
function requestOf(request: StripeRequest | undefined): StripeEvent["request"] {
  return { id: request?.id ?? null, idempotency_key: request?.idempotencyKey ?? null }
}

interface EventRow extends Entity {
  stripe_id: string
  type: string
  event: StripeEvent
}

/** Records Stripe events (served by `/v1/events`) and queues each for webhook delivery. */
export class StripeEvents {
  private readonly rows: Collection<EventRow>
  private readonly objects: StripeStore
  private readonly outbox: Outbox
  private readonly clock: Clock

  constructor(store: Store, objects: StripeStore, outbox: Outbox) {
    this.rows = store.collection<EventRow>("stripe.events", ["stripe_id", "type"])
    this.objects = objects
    this.outbox = outbox
    this.clock = store.clock
  }

  /** Emits `type` with a copy of `object` as it is now. `type` must be one the SDK knows. */
  emit(type: Stripe.Event.Type, object: object): StripeEvent {
    const event: StripeEvent = {
      id: newId("evt"),
      object: "event",
      api_version: STRIPE_API_VERSION,
      created: unix(this.clock()),
      data: { object: structuredClone(object) },
      livemode: false,
      pending_webhooks: this.subscribers(type),
      request: requestOf(currentRequest()),
      type,
    }

    this.rows.insert({ stripe_id: event.id, type, event })
    this.outbox.push(type, event)

    return event
  }

  routes(app: App): void {
    app.get("/v1/events/:id", (c) => {
      const id = c.req.param("id")
      const row = this.rows.findOneBy("stripe_id", id)

      return row ? c.json(row.event) : noSuch(c, "event", id)
    })

    app.get("/v1/events", (c) => {
      const type = c.req.query("type")
      const rows = type ? this.rows.findBy("type", type) : this.rows.all()

      return listPage(
        c,
        rows.map((row) => row.event),
        "/v1/events",
      )
    })
  }

  /** How many enabled endpoints will be sent an event of `type`. */
  private subscribers(type: string): number {
    return this.objects.webhookEndpoints.where(
      (endpoint) =>
        endpoint.status === "enabled" &&
        (endpoint.enabled_events.includes("*") || endpoint.enabled_events.includes(type)),
    ).length
  }
}
