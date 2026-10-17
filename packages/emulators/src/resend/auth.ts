import type { Middleware } from "../http.ts"
import { resendError } from "./helpers.ts"

/**
 * Resend's API key check: a request without `Authorization: Bearer re_…` is refused. The
 * messages follow Resend's documented `missing_api_key` (401) and `invalid_api_key` (403) errors;
 * their exact wording is an approximation. Any well-formed `re_` key is accepted.
 */
export function resendApiKey(): Middleware {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? ""
    const key = header.replace(/^Bearer\s+/i, "").trim()

    if (!key)
      return resendError(
        c,
        401,
        "missing_api_key",
        "Missing API key in the authorization header. Include the following header 'Authorization: Bearer YOUR_API_KEY' in the request.",
      )
    if (!/^re_\S+$/.test(key)) return resendError(c, 403, "invalid_api_key", "API key is invalid")

    return next()
  }
}
