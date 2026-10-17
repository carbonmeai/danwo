import type { Context, Middleware, Next } from "../http.ts"
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

/** The saved results by key, created on first use. */
function savedResults(store: Store): Map<string, SavedResult> {
  const existing = store.getData<Map<string, SavedResult>>("stripe.idempotency")

  if (existing) return existing

  const created = new Map<string, SavedResult>()

  store.setData("stripe.idempotency", created)

  return created
}

/** The answer to a retry: the saved response, or an error if the parameters changed. */
function replay(c: Context, key: string, previous: SavedResult, request: string): Response {
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

/** The answer while another request with the same key is still running. */
function stillRunning(c: Context, key: string): Response {
  return stripeError(
    c,
    409,
    "idempotency_error",
    "There is currently another in-progress request using this Idempotent Key (that probably means you submitted twice, and the other request is still going through): " +
      key +
      ". Please try again later.",
  )
}

/** Runs the request and keeps any non-5xx result under `key`. */
async function runAndSave(
  c: Context,
  next: Next,
  save: (status: number, body: string) => void,
  key: string,
): Promise<Response> {
  const response = await next()

  if (response.status < 500) {
    save(response.status, await response.clone().text())
    c.header("Idempotency-Key", key)
  }

  return response
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

  return async (c, next) => {
    const key = c.req.header("Idempotency-Key")

    if (c.req.method !== "POST" || !key || !c.req.path.startsWith("/v1/")) return next()

    const now = Math.floor(clock().getTime() / 1000)
    const request = `${c.req.method} ${c.req.path}\n${await c.req.text()}`
    const previous = savedResults(store).get(key)

    if (previous && now - previous.savedAt < KEY_TTL_SECONDS)
      return replay(c, key, previous, request)
    if (inFlight.has(key)) return stillRunning(c, key)

    inFlight.add(key)

    try {
      return await runAndSave(
        c,
        next,
        (status, body) => savedResults(store).set(key, { request, status, body, savedAt: now }),
        key,
      )
    } finally {
      inFlight.delete(key)
    }
  }
}
