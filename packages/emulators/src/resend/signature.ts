import { SVIX_DELIVERY, svixHeaders, svixSigningSecret } from "../svix.ts"

/**
 * Resend signs webhooks the Standard Webhooks (Svix) way, which the resend SDK's
 * `webhooks.verify` checks with the `standardwebhooks` package: headers `webhook-id`,
 * `webhook-timestamp` and `webhook-signature`.
 */
export function resendWebhookHeaders(
  secret: string,
  body: string,
  timestamp: number,
): Record<string, string> {
  return svixHeaders(secret, body, timestamp, "webhook")
}

/** A `whsec_` signing secret: 24 random bytes, base64. */
export const resendSigningSecret = svixSigningSecret

/** Resend delivers webhooks through Svix, on Svix's retry schedule. */
export const RESEND_DELIVERY = SVIX_DELIVERY
