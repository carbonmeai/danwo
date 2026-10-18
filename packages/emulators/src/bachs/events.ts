import type { Outbox } from "../outbox.ts"
import type { Clock } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { bachsId, iso } from "./helpers.ts"
import type { BachsStore } from "./store.ts"

/** The event envelope every Bachs webhook delivers. */
export interface BachsEvent {
  readonly id: string
  readonly type: string
  readonly created_at: string
  readonly organization_id: string
  readonly data: Record<string, unknown>
}

/** Queues Bachs events for delivery to the endpoints subscribed to them. */
export class BachsEvents {
  private readonly bachs: BachsStore
  private readonly outbox: Outbox
  private readonly clock: Clock

  constructor(bachs: BachsStore, outbox: Outbox, clock: Clock) {
    this.bachs = bachs
    this.outbox = outbox
    this.clock = clock
  }

  /** Emits `type` with a copy of `data` as it is now. */
  emit(type: string, data: Record<string, unknown>): BachsEvent {
    const event: BachsEvent = {
      id: `evt_${bachsId("x", 32).slice(2)}`,
      type,
      created_at: iso(this.clock()),
      organization_id: this.bachs.organization(),
      data: structuredClone(data),
    }

    this.outbox.push(type, event)

    return event
  }
}

/** The account's webhook endpoints, as the dispatcher addresses them. */
export function deliveryEndpoints(bachs: BachsStore): WebhookEndpoint[] {
  return bachs.endpoints.all().map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.eventTypes,
    secret: endpoint.secret,
    enabled: endpoint.enabled,
  }))
}
