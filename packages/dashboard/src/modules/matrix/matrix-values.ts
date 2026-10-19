/** How the matrix page sums and words a run's trials. */
import type { MatrixHistory } from "@danwo/runner/runner"

import { type Share, toneOf } from "../../lib/verdicts.ts"

/** What each verdict means in a matrix, as the legend explains it. */
export const LEGEND: readonly (readonly [string, string])[] = [
  ["passed", "held under the fault"],
  ["failed", "the fault broke it"],
  ["not-judged", "could not be judged"],
  ["invalid", "the fault never applied"],
]

/** The order the list shows trials in: what broke first. */
const LIST_ORDER = ["failed", "environment-error", "not-judged", "invalid", "passed"]

export function listedTrials(run: MatrixHistory): MatrixHistory["trials"] {
  return run.trials.toSorted((a, b) => LIST_ORDER.indexOf(a.status) - LIST_ORDER.indexOf(b.status))
}

/** How many trials held, broke, could not be judged, or never applied. */
function trialShares(run: MatrixHistory): Share[] {
  const held = run.trials.filter((t) => t.status === "passed").length
  const broke = run.trials.filter((t) => toneOf(t.status) === "failed").length
  const notJudged = run.trials.filter((t) => t.status === "not-judged").length

  return [
    { tone: "passed", count: held, label: "passed" },
    { tone: "failed", count: broke, label: "failed" },
    { tone: "notJudged", count: notJudged, label: "not judged" },
    { tone: "invalid", count: run.trials.length - held - broke - notJudged, label: "invalid" },
  ]
}

/** The invariant panel's words: what the rule is called, and how much of the matrix held. */
export function invariantSummary(run: MatrixHistory) {
  const shares = trialShares(run)
  const held = shares[0]?.count ?? 0
  const broke = shares[1]?.count ?? 0
  const of = run.trials.length

  return {
    shares,
    broke: broke > 0,
    label: run.judgedBy === "invariant" ? "Invariant" : "What must hold",
    headline: broke > 0 ? `Broke under ${broke} of ${of}` : `Held under ${held} of ${of}`,
    faults: of === 1 ? "fault" : "faults",
  }
}

/** What the matrix asks of the app, in words. */
export function ruleOf(run: MatrixHistory): string {
  if (run.judgedBy === "invariant")
    return "The test's invariant must hold after every fault. Each faulted run stops at its first breaking step, then the invariant reads what the app left in the providers."

  return run.judgedBy === "body"
    ? "The test must pass with every fault in place. Add an invariant with test(…).invariant(fn) to judge what the app left behind instead."
    : "Each faulted run is judged the same way as the clean run."
}
