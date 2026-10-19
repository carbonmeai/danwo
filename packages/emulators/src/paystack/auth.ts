import type { Context, Middleware } from "../http.ts"
import type { Integration } from "./entities.ts"
import { fail } from "./helpers.ts"
import { PROBLEMS } from "./problems.ts"
import type { PaystackStore } from "./store.ts"

/** Whether a request is for the hosted payment page, which the customer's browser opens without a key. */
function isCheckoutRequest(c: Context): boolean {
  return new URL(c.req.url).hostname === "checkout.paystack.com"
}

/** The bearer token of a request, when its `Authorization` header has one. */
function tokenOf(c: Context): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1]
}

/** The integration whose secret key the request's bearer token is. */
function callerOf(c: Context, paystack: PaystackStore): Integration | undefined {
  const token = tokenOf(c)

  return token === undefined ? undefined : paystack.integrations.get(token)
}

/**
 * Paystack's key check: API calls carry `Authorization: Bearer <secret key>`. A header without a
 * bearer token gets 401 saying the format is wrong, an unknown key 401 with "Invalid key", as
 * Paystack answers; the hosted page needs no key.
 */
export function paystackAuth(paystack: PaystackStore): Middleware {
  return async (c, next) => {
    if (isCheckoutRequest(c) || callerOf(c, paystack)) return next()

    return tokenOf(c) === undefined
      ? fail(c, 401, "Format is Authorization Bearer [secret key]", PROBLEMS.badAuthorizationHeader)
      : fail(c, 401, "Invalid key", PROBLEMS.badKey)
  }
}

/** The integration of a request that passed `paystackAuth`. */
export function requireIntegration(c: Context, paystack: PaystackStore): Integration {
  const caller = callerOf(c, paystack)

  if (caller === undefined) throw new Error("requireIntegration() outside paystackAuth")

  return caller
}
