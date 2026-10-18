import type { Middleware } from "../http.ts"
import { failure } from "./helpers.ts"

/**
 * Flutterwave's key check on `/v3/*`: a test-mode secret key as a Bearer token. A missing header is
 * "Authorization required"; any other key, live keys included, is refused, so a run pointed at the
 * emulator with production credentials fails loudly. The hosted payment page needs no key.
 */
export function flutterwaveKey(): Middleware {
  return async (c, next) => {
    if (!c.req.path.startsWith("/v3/") || c.req.path.startsWith("/v3/hosted/")) return next()

    const header = c.req.header("authorization") ?? ""
    const key = header.replace(/^Bearer:?\s+/i, "").trim()

    if (key === "") return failure(c, 401, "Authorization required")
    if (!/^FLWSECK_TEST-\S+$/.test(key)) return failure(c, 401, "Invalid authorization key")

    return next()
  }
}
