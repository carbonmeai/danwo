import type { Context, Middleware, Next } from "../http.ts"
import type { Clock, DataKey, Store } from "../store.ts"
import { bachsError } from "./helpers.ts"

/** How long a successful response stays cached under its key. */
const KEEP_MS = 24 * 60 * 60 * 1000

interface Kept {
  /** Method, path and body: a retry must match all three. */
  readonly fingerprint: string
  /** Null while the first request is still running. */
  readonly status: number | null
  readonly body: string
  readonly storedAt: number
}

const KEPT: DataKey<Map<string, Kept>> = { name: "bachs.idempotency" }

function keptResults(store: Store): Map<string, Kept> {
  const existing = store.getData(KEPT)

  if (existing) return existing

  const created = new Map<string, Kept>()

  store.setData(KEPT, created)

  return created
}

/** What a retry with a key already seen gets: the cached answer, a conflict, or "still running". */
function answerRetry(c: Context, kept: Kept, fingerprint: string): Response {
  if (kept.fingerprint !== fingerprint)
    return bachsError(
      c,
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency-Key was already used with a different request",
    )
  if (kept.status === null)
    return bachsError(
      c,
      409,
      "IDEMPOTENCY_IN_PROGRESS",
      "A request with this Idempotency-Key is still in progress",
    )

  return c.body(kept.body, kept.status, { "content-type": "application/json" })
}

/** Runs the request and caches a 2xx JSON answer; anything else frees the key again. */
async function runAndKeep(
  next: Next,
  results: Map<string, Kept>,
  key: string,
  entry: Kept,
): Promise<Response> {
  results.set(key, entry)

  const response = await next()

  if (response.status >= 200 && response.status < 300)
    results.set(key, { ...entry, status: response.status, body: await response.clone().text() })
  else results.delete(key)

  return response
}

/**
 * `Idempotency-Key` on public `POST` and `PATCH` requests under `/v1/`: a successful response is
 * cached for 24 hours and replayed to a retry with the same method, path and body; the same key
 * with a different request is `409 IDEMPOTENCY_CONFLICT`, and one that arrives while the first is
 * still running is `409 IDEMPOTENCY_IN_PROGRESS`. Errors are not cached.
 */
export function bachsIdempotency(store: Store, clock: Clock): Middleware {
  return async (c, next) => {
    const key = c.req.header("Idempotency-Key")

    if (
      !key ||
      !c.req.path.startsWith("/v1/") ||
      (c.req.method !== "POST" && c.req.method !== "PATCH")
    )
      return next()

    const results = keptResults(store)
    const fingerprint = `${c.req.method} ${c.req.path} ${await c.req.text()}`
    const scoped = `${c.req.header("Authorization") ?? ""} ${c.req.header("X-Account-Id") ?? ""} ${key}`
    const kept = results.get(scoped)
    const now = clock().getTime()

    if (kept && now - kept.storedAt < KEEP_MS) return answerRetry(c, kept, fingerprint)

    return runAndKeep(next, results, scoped, { fingerprint, status: null, body: "", storedAt: now })
  }
}
