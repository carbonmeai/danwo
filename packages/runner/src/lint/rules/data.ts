/** Data rules: what the app did with its own database after a call failed. */
import type { DataCall } from "@danwo/infra"

import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/** SQLSTATEs that mean "run the transaction again", by the name reports use. */
const RETRY_AGAIN: Readonly<Record<string, string>> = {
  "40001": "serialization_failure",
  "40P01": "deadlock_detected",
}

/** Whether a call after `failed` on the same service starts its work again. */
function triedAgain(calls: readonly DataCall[], failed: DataCall): boolean {
  const after = calls.slice(calls.indexOf(failed) + 1)

  return after.some(
    (call) =>
      call.service === failed.service &&
      (call.verb === "BEGIN" || call.operation === failed.operation),
  )
}

/** A Postgres call that failed to serialize or deadlocked, after which nothing ran it again. */
function unretriedSerialization(subject: LintSubject): RuleFinding[] {
  const calls = subject.dataCalls ?? []

  return calls
    .filter(
      (call) =>
        call.kind === "postgres" &&
        call.error !== undefined &&
        RETRY_AGAIN[call.error] !== undefined &&
        !triedAgain(calls, call),
    )
    .map((call) => ({
      provider: "postgres",
      message: `${call.operation} failed with ${RETRY_AGAIN[call.error ?? ""] ?? call.error} (${call.error ?? ""}) and the transaction was not tried again`,
      evidence: {},
    }))
}

export const noRetryOnSerialization: LintRule = {
  id: "data/no-retry-on-serialization",
  severity: "warning",
  providers: ["any"],
  summary:
    "A Postgres statement failed with serialization_failure (40001) or deadlock_detected (40P01) and its transaction was not run again.",
  hint: "Roll back and run the whole transaction again, with a few tries and backoff: Postgres asks for exactly that with these two errors.",
  check: unretriedSerialization,
}
