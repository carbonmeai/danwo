/**
 * Retrying with backoff, around every call that can fail for a moment. A retry is only safe when
 * the call it repeats is idempotent: an idempotency key, or a write that recognises its own row.
 */

/** How one kind of call is retried. */
export interface RetryPolicy {
  /** Names the call in the log, e.g. `resend emails.send`. */
  readonly name: string
  /** Attempts in all, the first included. */
  readonly attempts: number
  /**
   * Whether `error` is worth another attempt: `false` for a final one, `true` to retry after the
   * usual pause, or the milliseconds the server asked to wait (a 429's `Retry-After`).
   */
  readonly retryable: (error: unknown) => boolean | number
}

/** 100 ms before the second attempt, doubling to at most 1 s. */
const pause = (attempt: number) => Math.min(100 * 2 ** (attempt - 1), 1_000)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs `work` until it succeeds, it fails for good, or the policy's attempts run out. */
export async function retrying<T>(policy: RetryPolicy, work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (error) {
      const verdict = attempt < policy.attempts ? policy.retryable(error) : false

      if (verdict === false) throw error

      console.warn(`${policy.name}: attempt ${attempt} failed (${describe(error)}); retrying`)
      await sleep(verdict === true ? pause(attempt) : Math.max(pause(attempt), verdict))
    }
  }
}

/** A short description of an error for the log. */
export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
