import { createHmac } from "node:crypto"

import type { DeliveryPolicy } from "../webhooks.ts"

/**
 * The `Stripe-Signature` header value for a webhook body: the timestamp and an HMAC-SHA256 of
 * `"<timestamp>.<body>"` keyed with the endpoint's signing secret.
 */
export function stripeSignature(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")

  return `t=${timestamp},v1=${digest}`
}

/** Headers of one webhook delivery attempt. */
export function stripeWebhookHeaders(
  secret: string,
  body: string,
  timestamp: number,
): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
    "stripe-signature": stripeSignature(secret, body, timestamp),
  }
}

const MINUTE = 60_000

/**
 * How the emulator retries a failed webhook: three more attempts, after 5 minutes, 30 minutes
 * and 2 hours, each allowed 10 seconds. Live Stripe retries for days; test runs need it shorter.
 */
export const STRIPE_SANDBOX_DELIVERY: DeliveryPolicy = {
  retryDelaysMs: [5 * MINUTE, 30 * MINUTE, 120 * MINUTE],
  timeoutMs: 10_000,
}
