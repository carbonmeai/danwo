import { createHmac } from "node:crypto"

import { asRecord } from "../json.ts"

/**
 * Composio signs webhooks with headers `webhook-id`, `webhook-timestamp` (Unix seconds) and
 * `webhook-signature` = `v1,` + base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`, keyed with the
 * subscription's secret as it is written (the SDK's `triggers.verifyWebhook` checks exactly this,
 * and rejects timestamps more than five minutes from its clock). The id is the event's own, so a
 * retry or a duplicate carries the same one.
 */
export function composioWebhookHeaders(
  secret: string,
  body: string,
  timestamp: number,
): Record<string, string> {
  const id = idOf(body)
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64")

  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  }
}

function idOf(body: string): string {
  try {
    const id = asRecord(JSON.parse(body))?.["id"]

    return typeof id === "string" ? id : "msg_unknown"
  } catch {
    return "msg_unknown"
  }
}

/**
 * When a delivery that failed is tried again. Composio does not publish its schedule; this follows
 * the common Standard Webhooks one (5 s, 5 min, 30 min, 2 h, 5 h, 10 h), an approximation.
 */
export const COMPOSIO_DELIVERY = {
  retryDelaysMs: [5_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 5 * 3600_000, 10 * 3600_000],
  timeoutMs: 15_000,
} as const
