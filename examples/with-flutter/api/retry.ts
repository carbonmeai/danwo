/** How long to wait before each retry: about four seconds in all, longer than a brief outage. */
const DELAYS_MS: readonly number[] = [100, 250, 500, 1_000, 2_000]

/**
 * Whether an error is worth another try: `false` for a final one, `true` to retry after the usual
 * pause, or the milliseconds the server asked to wait (a 429's `Retry-After`).
 */
export type Retryable = (error: unknown) => boolean | number

/**
 * Runs `attempt`, and again after a pause each time it throws an error `retryable` accepts, until
 * it succeeds or the retries run out. Only retry work that is safe to repeat: an upsert, an update
 * to a fixed value, or a send with an idempotency key.
 */
export async function withRetry<T>(attempt: () => Promise<T>, retryable: Retryable): Promise<T> {
  for (const delay of DELAYS_MS) {
    try {
      return await attempt()
    } catch (error) {
      const verdict = retryable(error)

      if (verdict === false) throw error

      await new Promise((resolve) =>
        setTimeout(resolve, verdict === true ? delay : Math.max(delay, verdict)),
      )
    }
  }

  return attempt()
}
