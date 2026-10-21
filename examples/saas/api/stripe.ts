/**
 * Relay's Stripe client. The SDK retries 5xx answers, 409s and dropped connections itself,
 * reusing each write's idempotency key; `stripeCall` adds what it leaves out: backing off on a 429.
 */
import { Stripe } from "stripe"

import { broken } from "../shared/bugs.ts"
import { retrying } from "../shared/retry.ts"
import { settings } from "./settings.ts"

export const stripe = new Stripe(settings.STRIPE_SECRET_KEY, {
  maxNetworkRetries: broken("no-onboarding-retry") ? 0 : 2,
  timeout: 10_000,
})

/** Whether Stripe asked Relay to slow down, or failed in a way worth one more try. */
function retryable(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeConnectionError
  )
}

/** Runs one Stripe call with Relay's retry policy on top of the SDK's own. */
export function stripeCall<T>(name: string, call: () => Promise<T>): Promise<T> {
  if (broken("no-onboarding-retry")) return call()

  return retrying(
    { name: `stripe ${name}`, attempts: 4, retryable, delayMs: (attempt) => 250 * attempt },
    call,
  )
}

/**
 * An idempotency key for a write, or none with SAAS_BUG=no-onboarding-retry: then a retried
 * request makes a second customer or subscription.
 */
export function idempotent(key: string): Stripe.RequestOptions {
  return broken("no-onboarding-retry") ? {} : { idempotencyKey: key }
}
