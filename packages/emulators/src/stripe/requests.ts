/**
 * The API request being answered, as Stripe names it: every call gets a `req_` id, which error
 * bodies link to and events created by that call carry with the call's idempotency key. Events
 * that happen outside a call (a webhook-driven settlement, a renewal on the clock) carry neither.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { randomBytes } from "node:crypto"

import type { Middleware } from "../http.ts"

/** What an event or an error knows about the call that caused it. */
export interface StripeRequest {
  readonly id: string
  readonly idempotencyKey: string | null
}

const current = new AsyncLocalStorage<StripeRequest>()

/** A request id in Stripe's form: `req_` and fourteen letters or digits. */
function requestId(): string {
  const letters = randomBytes(24).toString("base64url").replaceAll(/[-_]/g, "")

  return `req_${letters.slice(0, 14).padEnd(14, "0")}`
}

/** The call being answered, if any. */
export function currentRequest(): StripeRequest | undefined {
  return current.getStore()
}

/** Names each `/v1/*` call for the handlers that run inside it. */
export function stripeRequests(): Middleware {
  return (c, next) => {
    if (!c.req.path.startsWith("/v1/")) return next()

    const request: StripeRequest = {
      id: requestId(),
      idempotencyKey: c.req.header("Idempotency-Key") ?? null,
    }

    return current.run(request, next)
  }
}
