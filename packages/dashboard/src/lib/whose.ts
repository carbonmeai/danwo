/**
 * Whose failure each failed test or trial was, as the dashboard reads it from the history: the
 * verdict a failing test ended on, a run's failures by verdict, and the colour each verdict shows in.
 */
import type { FailureVerdict, HistoryTest, RunHistory, Verdict } from "@danwo/runner/runner"

import { type Tone, toneOf } from "./verdicts.ts"

/** The colour each verdict's badge reads in: red for the app, amber for the test. */
export const WHOSE_TONE: Readonly<Record<Verdict, Tone>> = {
  app: "failed",
  test: "flaky",
  environment: "notJudged",
  danwo: "invalid",
  undecided: "invalid",
}

/** The verdict a failing test ended on: its last attempt's; none for a test that did not fail. */
export function testVerdict(test: HistoryTest): FailureVerdict | undefined {
  if (toneOf(test.status) !== "failed") return undefined

  return test.attempts.findLast((attempt) => attempt.verdict !== undefined)?.verdict
}

/** The statuses of a matrix trial that count as failed. */
const BROKE: ReadonlySet<string> = new Set(["failed", "environment-error"])

/** The verdicts of a run's failures: its failed tests, or its failed matrix trials. */
export function runVerdicts(run: RunHistory): FailureVerdict[] {
  if (run.kind === "test") return run.tests.flatMap((test) => testVerdict(test) ?? [])

  return run.trials.flatMap((trial) =>
    BROKE.has(trial.status) && trial.verdict !== undefined ? [trial.verdict] : [],
  )
}

/** Whether a verdict filter keeps the run: no filter, or a failure with that verdict. */
export function hasVerdict(run: RunHistory, verdict: Verdict | undefined): boolean {
  return verdict === undefined || runVerdicts(run).some((found) => found.verdict === verdict)
}

/** The verdicts as a filter offers them: the value and its words. */
export const VERDICT_CHOICES: readonly (readonly [Verdict, string])[] = [
  ["app", "App bugs"],
  ["test", "Test issues"],
  ["environment", "Environment"],
  ["danwo", "danwo bugs"],
  ["undecided", "Undecided"],
]

/** A verdict from an address, or undefined when it names none. */
export function verdictParam(value: unknown): Verdict | undefined {
  return VERDICT_CHOICES.find(([key]) => key === value)?.[0]
}
