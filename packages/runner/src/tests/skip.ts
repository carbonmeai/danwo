/** Thrown by `test.skip(...)` inside a running test; the executor reports the test as skipped. */
export class SkipSignal extends Error {
  readonly reason: string | undefined

  constructor(reason: string | undefined) {
    super(reason === undefined ? "skipped" : `skipped: ${reason}`)
    this.name = "SkipSignal"
    this.reason = reason
  }
}

export function isSkipSignal(error: unknown): error is SkipSignal {
  return error instanceof SkipSignal
}
