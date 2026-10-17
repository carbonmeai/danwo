export class DeadlineExceeded extends Error {
  readonly ms: number

  constructor(ms: number, what: string) {
    super(`${what} timed out after ${ms} ms`)
    this.name = "DeadlineExceeded"
    this.ms = ms
  }
}

/**
 * Runs `work`, rejecting with DeadlineExceeded when it takes longer than `ms`. The work itself is
 * not cancelled; the caller tears down what it was using.
 */
export async function withDeadline<T>(
  work: () => Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded(ms, what)), ms)
  })

  try {
    return await Promise.race([work(), expired])
  } finally {
    clearTimeout(timer)
  }
}
