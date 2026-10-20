/** How a test run's page sorts and sums its tests. */
import type { HistoryTest, TestHistory, Usage } from "@danwo/runner/runner"
import { verdictSummary } from "@danwo/runner/verdict"

import { percent } from "../../lib/format.ts"
import { type Share, toneOf } from "../../lib/verdicts.ts"
import { runVerdicts } from "../../lib/whose.ts"
import { cacheHitRate } from "../runs/run-trend.ts"

/** Failures first, then flaky, then the rest, so what needs looking at is on top. */
const ORDER = [
  "failed",
  "timed-out",
  "interrupted",
  "environment-error",
  "flaky",
  "passed",
  "skipped",
]

export function sortedTests(run: TestHistory): HistoryTest[] {
  return run.tests.toSorted((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
}

/** A run's tests by verdict, failures counting every way a test can fail. */
function testShares(run: TestHistory): Share[] {
  const count = (status: string) => run.tests.filter((t) => t.status === status).length

  return [
    { tone: "passed", count: count("passed"), label: "passed" },
    { tone: "flaky", count: count("flaky"), label: "flaky" },
    {
      tone: "failed",
      count: run.tests.filter((t) => toneOf(t.status) === "failed").length,
      label: "failed",
    },
    { tone: "invalid", count: count("skipped"), label: "skipped" },
  ]
}

/** Under a run's failed count: whose failures they were, else how many flaked. */
function failedNote(run: TestHistory, flaky: number): string {
  return verdictSummary(runVerdicts(run)) || (flaky > 0 ? `${flaky} flaky` : "none flaky")
}

/** A test run's headline figures: its title, the verdict counts and what the model cost. */
export function testFigures(run: TestHistory) {
  const shares = testShares(run)
  const { calls } = run.usage.spent
  const rate = cacheHitRate(run.usage)
  const flaky = shares[1]?.count ?? 0

  return {
    shares,
    failedNote: failedNote(run, flaky),
    title: `${run.tests.length} ${run.tests.length === 1 ? "test" : "tests"}`,
    passed: shares[0]?.count ?? 0,
    flaky,
    failed: shares[2]?.count ?? 0,
    spend:
      calls === 0 ? "no model calls" : `${calls} calls · ${percent(rate)} from the replay cache`,
  }
}

/** A cache summary such as `3 replayed, 1 relocated`. */
export function cacheLine(usages: readonly (Usage | undefined)[]): string {
  const totals = new Map<string, number>()

  for (const usage of usages)
    for (const [outcome, n] of Object.entries(usage?.cache ?? {}))
      totals.set(outcome, (totals.get(outcome) ?? 0) + (n ?? 0))

  return [...totals].map(([outcome, n]) => `${n} ${outcome}`).join(", ") || "–"
}
