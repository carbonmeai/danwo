/**
 * What the customer reads when the model fails: a plain sentence and a way forward, never the
 * provider's own error text. The AI SDK has already retried what was worth retrying by now.
 */

/** Shown when the model is rate-limited. The tests look for it. */
export const BUSY = "The assistant is busy right now. Wait a moment, then try again."

/** Shown when the model or the gateway is down, overloaded or unreachable. */
export const UNAVAILABLE = "The assistant is unavailable right now. Please try again in a minute."

/** Shown for anything else. */
export const FAILED = "Something went wrong with this answer. Please try again."

/**
 * The HTTP status an error carries, looking through what wraps it: the AI SDK's `RetryError`
 * keeps the last attempt's error, and provider errors keep theirs as `statusCode` or `cause`.
 */
function statusOf(error: unknown, depth = 0): number | undefined {
  if (typeof error !== "object" || error === null || depth > 5) return undefined

  const status = Reflect.get(error, "statusCode") ?? Reflect.get(error, "status")

  if (typeof status === "number") return status

  return (
    statusOf(Reflect.get(error, "lastError"), depth + 1) ??
    statusOf(Reflect.get(error, "cause"), depth + 1)
  )
}

/** Whether the request never got an answer: the connection dropped or timed out. */
function unreachable(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)

  return /fetch failed|ECONNRESET|socket|network|timeout|aborted/i.test(text)
}

/** The sentence the customer sees for `error`. */
export function friendlyError(error: unknown): string {
  const status = statusOf(error)

  if (status === 429) return BUSY
  if ((status !== undefined && status >= 500) || unreachable(error)) return UNAVAILABLE

  return FAILED
}

/** The error as it came, for the server's log and for the `no-retry` bug's page. */
export function rawError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
