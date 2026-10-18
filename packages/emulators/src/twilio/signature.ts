import { createHmac } from "node:crypto"

import type { DeliveryPolicy, WebhookSigner } from "../webhooks.ts"

/**
 * How Twilio signs what it POSTs to an app: an HMAC-SHA1, keyed with the account's auth token, of
 * the full URL followed by every form field's name and value in name order, base64-encoded and
 * sent as `X-Twilio-Signature`. There is no timestamp, so a replayed request verifies as well as
 * the first.
 */
export function twilioSignature(authToken: string, url: string, form: URLSearchParams): string {
  const fields = [...form.keys()]
    .filter((name, at, all) => all.indexOf(name) === at)
    .toSorted()
    .map((name) => name + form.getAll(name).toSorted().join(name))
    .join("")

  return createHmac("sha1", authToken)
    .update(url + fields)
    .digest("base64")
}

/** Signs a form-encoded webhook as Twilio does; the endpoint's secret is the auth token. */
export const twilioSigner: WebhookSigner = ({ endpoint, body }) => ({
  "content-type": "application/x-www-form-urlencoded",
  "x-twilio-signature": twilioSignature(endpoint.secret, endpoint.url, new URLSearchParams(body)),
})

/**
 * Twilio waits 15 seconds for an app's answer and does not retry a failed message webhook or
 * status callback, so a delivery is made once.
 */
export const TWILIO_DELIVERY: DeliveryPolicy = { retryDelaysMs: [], timeoutMs: 15_000 }
