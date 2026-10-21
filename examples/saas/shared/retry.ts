/**
 * Retrying with backoff: what Relay does around every call that can fail for a moment, its
 * database included. A retry is only safe because each call it repeats is idempotent: an
 * idempotency key, a dedupe table or a unique index makes the second attempt a no-op.
 */

/** How one kind of call is retried. */
export interface RetryPolicy {
  /** Names the call in the log, e.g. `stripe checkout.sessions.create`. */
  readonly name: string
  /** Attempts in all, the first included. */
  readonly attempts: number
  /** Whether `error` is worth another attempt. */
  readonly retryable: (error: unknown) => boolean
  /** How long to wait before the next attempt; default 100 ms, doubling. */
  readonly delayMs?: (attempt: number, error: unknown) => number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs `work` until it succeeds, it fails for good, or the policy's attempts run out. */
export async function retrying<T>(policy: RetryPolicy, work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (error) {
      if (attempt >= policy.attempts || !policy.retryable(error)) throw error

      const wait = policy.delayMs?.(attempt, error) ?? 100 * 2 ** (attempt - 1)

      console.warn(`${policy.name}: attempt ${attempt} failed (${describe(error)}); retrying`)
      await sleep(wait)
    }
  }
}

/** A short description of an error for the log. */
export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** Rejects with a timeout error when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what} took longer than ${ms} ms`)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class TimeoutError extends Error {
  override readonly name = "TimeoutError"
}
