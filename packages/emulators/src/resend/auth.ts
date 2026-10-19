import type { Middleware } from "../http.ts"
import type { KeyPermission } from "./entities.ts"
import { resendError } from "./helpers.ts"
import type { ResendStore } from "./store.ts"

/** The calls a sending-only key may make. */
const SENDING = new Set(["POST /emails", "POST /emails/batch"])

/** What a key the emulator issued or was seeded with may do; any other `re_` key has full access. */
function permissionOf(objects: ResendStore, token: string): KeyPermission {
  for (const key of objects.keys.all()) {
    const extra = objects.keys.extra(key.id)

    if (extra?.token === token) return extra.permission ?? "full_access"
  }

  return "full_access"
}

/**
 * Resend's API key check: a request without `Authorization: Bearer re_…` is refused. The
 * messages follow Resend's documented `missing_api_key` (401) and `invalid_api_key` (403) errors;
 * their exact wording is an approximation. Any well-formed `re_` key is accepted, and a known key
 * with `sending_access` gets Resend's 401 `restricted_api_key` on anything but a send.
 */
export function resendApiKey(objects: ResendStore): Middleware {
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
    if (
      permissionOf(objects, key) === "sending_access" &&
      !SENDING.has(`${c.req.method} ${c.req.path}`)
    )
      return resendError(
        c,
        401,
        "restricted_api_key",
        "This API key is restricted to only send emails",
      )

    return next()
  }
}
