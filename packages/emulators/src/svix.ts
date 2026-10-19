import { createHash, createHmac, randomBytes } from "node:crypto"

/**
 * Webhooks signed the Standard Webhooks (Svix) way: an id, a Unix-seconds timestamp and a
 * signature `v1,` + base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`, keyed with the
 * base64-decoded secret after its `whsec_` prefix. Resend sends the headers as `webhook-*`;
 * Clerk, which delivers through Svix too, as `svix-*`. Verifiers reject timestamps more than five
 * minutes away from their clock, in either direction.
 */
export function svixHeaders(
  secret: string,
  body: string,
  timestamp: number,
  prefix: "webhook" | "svix",
): Record<string, string> {
  // One id per message, so a retry or a duplicate delivery carries the same id, as Svix's do.
  const id = `msg_${createHash("sha256").update(body).digest("base64url").slice(0, 27)}`
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")

  return {
    "Content-Type": "application/json",
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: String(timestamp),
    [`${prefix}-signature`]: `v1,${signature}`,
  }
}

/** A `whsec_` signing secret: 24 random bytes, base64. */
export function svixSigningSecret(): string {
  return `whsec_${randomBytes(24).toString("base64")}`
}

/**
 * Svix's documented retry schedule (immediately, then 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h).
 * The attempt timeout is an approximation.
 */
export const SVIX_DELIVERY = {
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
