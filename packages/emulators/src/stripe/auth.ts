import type { Middleware } from "../http.ts"
import { stripeError } from "./helpers.ts"

const MISSING_KEY =
  "You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY'). See https://stripe.com/docs/api#authentication for details, or we can help at https://support.stripe.com/."

/** A redacted key as Stripe shows it in errors: `sk_test_****abcd`. */
function redact(key: string): string {
  const prefix = key.match(/^[a-z]+_[a-z]+_/)?.[0] ?? ""

  return `${prefix}****${key.slice(-4)}`
}

/**
 * Accepts any test-mode secret or restricted key on `/v1/*`. Live keys are refused, so a run that is
 * pointed at the emulator by mistake with production credentials fails loudly.
 */
export function stripeApiKey(): Middleware {
  return async (c, next) => {
    if (!c.req.path.startsWith("/v1/")) return next()

    const header = c.req.header("Authorization") ?? ""
    const key = header.replace(/^Bearer\s+/i, "").trim()

    if (!key) return stripeError(c, 401, "invalid_request_error", MISSING_KEY)
    if (!/^(sk|rk)_test_\S+$/.test(key))
      return stripeError(
        c,
        401,
        "invalid_request_error",
        `Invalid API Key provided: ${redact(key)}`,
      )

    return next()
  }
}
