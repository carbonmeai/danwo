/**
 * The shop's Stripe client. The SDK retries 5xx answers, 409s and dropped connections itself,
 * reusing the request's idempotency key; `stripeCall` adds what it leaves out: backing off on a
 * 429 rate limit.
 */
import { Stripe } from "stripe"

import { retrying } from "./retry.ts"
import { settings } from "./settings.ts"

export const stripe = new Stripe(settings.STRIPE_SECRET_KEY, {
  maxNetworkRetries: 2,
  timeout: 10_000,
})

/** Whether Stripe asked the shop to slow down, or failed in a way worth one more try. */
function retryable(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeConnectionError
  )
}

/** Runs one Stripe call with the shop's retry policy on top of the SDK's own. */
export function stripeCall<T>(name: string, call: () => Promise<T>): Promise<T> {
  return retrying(
    { name: `stripe ${name}`, attempts: 4, retryable, delayMs: (attempt) => 250 * attempt },
    call,
  )
}
