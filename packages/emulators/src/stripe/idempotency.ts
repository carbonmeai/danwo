import type { Middleware } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import { stripeError } from "./helpers.ts"

const KEY_TTL_SECONDS = 24 * 60 * 60

interface SavedResult {
  /** Method, path and body: a replay must match all three. */
  request: string
  status: number
  body: string
  savedAt: number
}

/**
 * Stripe's `Idempotency-Key` behaviour on POST: the first result is saved, a retry with the same
 * key and parameters gets it back with `Idempotent-Replayed: true`, the same key with different
 * parameters is an `idempotency_error`, and keys expire after 24 hours. Saved results live in the
 * store, so they follow snapshot, restore and reset.
 *
 * Simplification: Stripe saves a result only once the endpoint started executing. Here, any
 * non-5xx response is saved, including parameter errors.
 */
export function stripeIdempotency(store: Store, clock: Clock): Middleware {
  const inFlight = new Set<string>()

  const saved = (): Map<string, SavedResult> => {
    let map = store.getData<Map<string, SavedResult>>("stripe.idempotency")

    if (!map) {
      map = new Map()
      store.setData("stripe.idempotency", map)
    }

    return map
  }

  return async (c, next) => {
    const key = c.req.header("Idempotency-Key")

    if (c.req.method !== "POST" || !key || !c.req.path.startsWith("/v1/")) return next()

    const now = Math.floor(clock().getTime() / 1000)
    const request = `${c.req.method} ${c.req.path}\n${await c.req.text()}`
    const previous = saved().get(key)

    if (previous && now - previous.savedAt < KEY_TTL_SECONDS) {
      if (previous.request !== request)
        return stripeError(
          c,
          400,
          "idempotency_error",
          `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' if you meant to execute a different request.`,
        )

      return c.body(previous.body, previous.status, {
        "Content-Type": "application/json",
        "Idempotent-Replayed": "true",
        "Idempotency-Key": key,
      })
    }

    if (inFlight.has(key))
      return stripeError(
        c,
        409,
        "idempotency_error",
        "There is currently another in-progress request using this Idempotent Key (that probably means you submitted twice, and the other request is still going through): " +
          key +
          ". Please try again later.",
      )

    inFlight.add(key)

    try {
      const response = await next()

      if (response && response.status < 500) {
        const body = await response.clone().text()

        saved().set(key, { request, status: response.status, body, savedAt: now })
        c.header("Idempotency-Key", key)
      }

      return response
    } finally {
      inFlight.delete(key)
    }
  }
}
