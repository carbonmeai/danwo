import type { Context, Middleware } from "../http.ts"
import type { Integration } from "./entities.ts"
import { fail } from "./helpers.ts"
import type { PaystackStore } from "./store.ts"

/** Whether a request is for the hosted payment page, which the customer's browser opens without a key. */
function isCheckoutRequest(c: Context): boolean {
  return new URL(c.req.url).hostname === "checkout.paystack.com"
}

/** The integration whose secret key the request's bearer token is. */
function callerOf(c: Context, paystack: PaystackStore): Integration | undefined {
  const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1]

  return token === undefined ? undefined : paystack.integrations.get(token)
}

/**
 * Paystack's key check: API calls carry `Authorization: Bearer <secret key>`. A missing or unknown
 * key gets 401 with "Invalid key", as Paystack answers; the hosted page needs no key.
 */
export function paystackAuth(paystack: PaystackStore): Middleware {
  return async (c, next) => {
    if (isCheckoutRequest(c) || callerOf(c, paystack)) return next()

    return fail(c, 401, "Invalid key")
  }
}

/** The integration of a request that passed `paystackAuth`. */
export function requireIntegration(c: Context, paystack: PaystackStore): Integration {
  const caller = callerOf(c, paystack)

  if (caller === undefined) throw new Error("requireIntegration() outside paystackAuth")

  return caller
}
