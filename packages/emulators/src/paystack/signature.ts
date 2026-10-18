import { createHmac } from "node:crypto"

import type { Outbox } from "../outbox.ts"
import type { DeliveryPolicy, WebhookEndpoint, WebhookSigner } from "../webhooks.ts"
import type { PaystackStore } from "./store.ts"

/**
 * How Paystack signs a webhook: an HMAC-SHA512 of the raw JSON body keyed with the integration's
 * secret key, hex-encoded, in `x-paystack-signature`. There is no timestamp, so a replayed event
 * verifies as well as the first.
 */
export function paystackSignature(secretKey: string, body: string): string {
  return createHmac("sha512", secretKey).update(body).digest("hex")
}

/** Signs a webhook as Paystack does; the endpoint's secret is the integration's secret key. */
export const paystackSigner: WebhookSigner = ({ endpoint, body }) => ({
  "content-type": "application/json",
  "x-paystack-signature": paystackSignature(endpoint.secret, body),
})

const MINUTE = 60_000

/**
 * How the emulator retries an event the app did not answer with 200: every 3 minutes four times,
 * then hourly, as Paystack does in live mode (cut short, since test runs cannot wait 72 hours).
 */
export const PAYSTACK_DELIVERY: DeliveryPolicy = {
  retryDelaysMs: [3 * MINUTE, 3 * MINUTE, 3 * MINUTE, 3 * MINUTE, 60 * MINUTE, 60 * MINUTE],
  timeoutMs: 30_000,
}

/** Where each integration's events go: its webhook URL, signed with its secret key. */
export function webhookEndpoints(paystack: PaystackStore): WebhookEndpoint[] {
  return paystack.integrations
    .all()
    .filter((integration) => integration.webhookUrl !== null)
    .map((integration) => ({
      id: `integration ${integration.number}`,
      url: integration.webhookUrl ?? "",
      events: ["*"],
      secret: integration.id,
      enabled: true,
    }))
}

/** Queues one event for the integration's webhook, in Paystack's `{ event, data }` envelope. */
export function emitEvent(outbox: Outbox, event: string, data: unknown): void {
  outbox.push(event, { event, data })
}
