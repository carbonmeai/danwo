import { createHmac } from "node:crypto"

import type { DeliveryPolicy, WebhookSigner } from "../webhooks.ts"

/**
 * The `flutterwave-signature` of a webhook body: a base64 HMAC-SHA256 of the raw body, keyed with
 * the secret hash set on the dashboard.
 */
export function flutterwaveSignature(secretHash: string, body: string): string {
  return createHmac("sha256", secretHash).update(body).digest("base64")
}

/**
 * Headers of a webhook: `verif-hash` carries the secret hash itself, and `flutterwave-signature` an
 * HMAC of the body under it, so an app checking either way accepts it.
 */
export const flutterwaveSigner: WebhookSigner = ({ endpoint, body }) => ({
  "content-type": "application/json",
  "verif-hash": endpoint.secret,
  "flutterwave-signature": flutterwaveSignature(endpoint.secret, body),
})

/**
 * With retries on, a webhook that did not get a 200 is sent again 3 times, 30 minutes apart; the
 * app has 60 seconds to answer each attempt.
 */
export const FLUTTERWAVE_DELIVERY: DeliveryPolicy = {
  retryDelaysMs: [30 * 60_000, 30 * 60_000, 30 * 60_000],
  timeoutMs: 60_000,
}
