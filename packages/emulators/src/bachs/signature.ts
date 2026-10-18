import { createHmac } from "node:crypto"

import type { Clock } from "../store.ts"
import type { DeliveryPolicy, WebhookSigner } from "../webhooks.ts"

/** The hex HMAC-SHA256 Bachs signs a delivery with: of `"<timestamp>.<raw body>"`, keyed by the endpoint's secret. */
export function bachsSignature(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
}

/**
 * Signs deliveries the way Bachs does: the timestamp and signature as separate headers, and the same
 * digest in `X-Bachs-Signature-V2` with the scheme named (`t=<timestamp>,v1=<signature>`).
 *
 * The timestamp is the apps' wall-clock time (`wall`, which follows time travel), shifted back by
 * however far the attempt meant to sign in the past (a stale delivery). Apps check it against their
 * own clock in both directions (the SDK refuses one more than five minutes off either way), and the
 * emulator's clock may have run ahead of theirs while deliveries were held back; real Bachs signs
 * with the time it actually sends.
 */
export function bachsSigner(clock: Clock, wall: Clock): WebhookSigner {
  return ({ endpoint, body, timestamp }) => {
    const pastBy = Math.max(0, Math.floor(clock().getTime() / 1000) - timestamp)
    const sentAt = Math.floor(wall().getTime() / 1000) - pastBy
    const signature = bachsSignature(endpoint.secret, body, sentAt)

    return {
      "content-type": "application/json",
      "user-agent": "Bachs-Webhooks/1.0",
      "x-bachs-timestamp": String(sentAt),
      "x-bachs-signature": signature,
      "x-bachs-signature-v2": `t=${sentAt},v1=${signature}`,
    }
  }
}

const MINUTE = 60_000

/**
 * How a failed delivery is retried: up to five tries, the retries about 1, 5, 15 and 60 minutes
 * after each failure, each try allowed 10 seconds to answer.
 */
export const BACHS_DELIVERY: DeliveryPolicy = {
  retryDelaysMs: [MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE],
  timeoutMs: 10_000,
}
