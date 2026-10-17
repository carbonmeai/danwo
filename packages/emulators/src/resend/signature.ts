import { createHash, createHmac, randomBytes } from "node:crypto"

/**
 * Resend signs webhooks the Standard Webhooks (Svix) way, which the resend SDK's
 * `webhooks.verify` checks with the `standardwebhooks` package: headers `webhook-id`,
 * `webhook-timestamp` (Unix seconds) and `webhook-signature` = `v1,` + base64 HMAC-SHA256 of
 * `${id}.${timestamp}.${body}`, keyed with the base64-decoded secret after its `whsec_` prefix.
 * The verifier rejects timestamps more than five minutes away from its clock, in either direction.
 */
export function resendWebhookHeaders(
  secret: string,
  body: string,
  timestamp: number,
): Record<string, string> {
  // One id per message, so a retry or a duplicate delivery carries the same id, as Svix's do.
  const id = `msg_${createHash("sha256").update(body).digest("base64url").slice(0, 27)}`
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")

  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  }
}

/** A `whsec_` signing secret: 24 random bytes, base64. */
export function resendSigningSecret(): string {
  return `whsec_${randomBytes(24).toString("base64")}`
}

/**
 * Resend delivers webhooks through Svix; this is Svix's documented retry schedule (immediately,
 * then 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h). The attempt timeout is an approximation. Verify
 * both against a real Resend account before relying on exact timings.
 */
export const RESEND_DELIVERY = {
  retryDelaysMs: [
    5_000,
    5 * 60_000,
    30 * 60_000,
    2 * 3600_000,
    5 * 3600_000,
    10 * 3600_000,
    10 * 3600_000,
  ],
  timeoutMs: 15_000,
} as const
