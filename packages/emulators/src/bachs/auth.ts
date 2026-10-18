import type { Middleware } from "../http.ts"
import { bachsError } from "./helpers.ts"

/** The key prefix each API host takes: sandbox keys only work on the sandbox host, live keys on the live one. */
const KEY_PREFIX_BY_HOST: Readonly<Record<string, string>> = {
  "api.bachs.io": "sk_live_",
  "sandbox-api.bachs.io": "sk_sandbox_",
}

/**
 * Bearer secret keys on `/v1/*`: `sk_sandbox_…` against the sandbox host and `sk_live_…` against
 * the live one. Other hosts (a local test server) take either. A missing, malformed or
 * wrong-environment key is a 401.
 */
export function bachsApiKey(): Middleware {
  return async (c, next) => {
    if (!c.req.path.startsWith("/v1/")) return next()

    const key = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()

    if (!key) return bachsError(c, 401, "UNAUTHORIZED", "Missing API key")

    const required = KEY_PREFIX_BY_HOST[new URL(c.req.url).hostname]
    const wellFormed = /^sk_(sandbox|live)_\S+$/.test(key)

    if (!wellFormed || (required !== undefined && !key.startsWith(required)))
      return bachsError(c, 401, "UNAUTHORIZED", "Invalid API key")

    return next()
  }
}
