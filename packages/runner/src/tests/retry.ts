// How one test's attempts add up to its result.

export type AttemptStatus = "passed" | "failed" | "timed-out" | "interrupted" | "skipped"

/** A test's result over its attempts: `flaky` when a retry passed after a failure. */
export type ResultStatus = AttemptStatus | "flaky"

/** Whether an attempt that ended with `status` earns another try (if retries remain). */
export function worthRetrying(status: AttemptStatus): boolean {
  return status === "failed" || status === "timed-out"
}

export function resultOf(attempts: readonly { readonly status: AttemptStatus }[]): ResultStatus {
  const last = attempts.at(-1)?.status ?? "skipped"

  return last === "passed" && attempts.length > 1 ? "flaky" : last
}
