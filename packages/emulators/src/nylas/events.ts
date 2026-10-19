import { createHmac, randomUUID } from "node:crypto"

import type { Outbox } from "../outbox.ts"
import type { Clock } from "../store.ts"
import type { NylasGrant } from "./entities.ts"

/** The webhook trigger types the emulator sends. */
export const NYLAS_TRIGGERS = [
  "grant.created",
  "grant.updated",
  "grant.deleted",
  "grant.expired",
  "message.created",
  "message.updated",
  "thread.replied",
  "event.created",
  "event.updated",
  "event.deleted",
  "calendar.created",
  "calendar.updated",
  "calendar.deleted",
  "contact.updated",
  "contact.deleted",
  "folder.created",
  "booking.created",
  "booking.cancelled",
  "booking.rescheduled",
] as const

export type NylasTrigger = (typeof NYLAS_TRIGGERS)[number]

/** Where a notification says it came from, as Nylas names its sources. */
function sourceOf(trigger: NylasTrigger, provider: string): string {
  if (trigger.startsWith("grant.")) return "/nylas/passthru"
  if (trigger.startsWith("booking.")) return "/nylas/scheduler"

  const kind =
    trigger.startsWith("message.") || trigger.startsWith("thread.") ? "emails" : "calendar"

  return `/${provider}/${kind}/realtime`
}

/** Queues Nylas's webhook notifications, in the CloudEvents-style shape v3 sends. */
export class NylasEvents {
  private readonly outbox: Outbox
  private readonly clock: Clock
  private readonly applicationId: () => string

  constructor(outbox: Outbox, clock: Clock, applicationId: () => string) {
    this.outbox = outbox
    this.clock = clock
    this.applicationId = applicationId
  }

  /** A change to an object of `grant`'s: `object` is the object as the API returns it. */
  emit(trigger: NylasTrigger, grant: Pick<NylasGrant, "id" | "provider">, object: unknown): void {
    this.outbox.push(trigger, {
      specversion: "1.0",
      type: trigger,
      source: sourceOf(trigger, grant.provider),
      id: randomUUID(),
      time: Math.floor(this.clock().getTime() / 1000),
      webhook_delivery_attempt: 1,
      data: { application_id: this.applicationId(), grant_id: grant.id, object },
    })
  }

  /** A grant was made, changed, removed or stopped working. */
  grant(
    trigger: "grant.created" | "grant.updated" | "grant.deleted" | "grant.expired",
    grant: NylasGrant,
  ): void {
    this.emit(trigger, grant, {
      grant_id: grant.id,
      provider: grant.provider,
      integration_id: this.applicationId(),
      email: grant.email,
      ...(trigger === "grant.created" && { code: 200 }),
    })
  }
}

/** The header Nylas signs a webhook with: hex HMAC-SHA256 of the raw body, keyed with its secret. */
export function nylasWebhookHeaders(secret: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Nylas-Signature": createHmac("sha256", secret).update(body).digest("hex"),
  }
}

/** Nylas retries a delivery that failed a few times over the next hours; the schedule is an approximation. */
export const NYLAS_DELIVERY = {
  retryDelaysMs: [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000],
  timeoutMs: 10_000,
} as const
