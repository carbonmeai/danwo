/**
 * The benchmark's numbers, worked out from what its runs did: per style, how many scenarios pass
 * on the correct app, how many planted bugs make the right scenario fail, what the model cost on
 * the first run and on the replay, and how many provider bugs `danwo matrix` catches.
 */
import type { Bug } from "../app/bugs.ts"
import type { Scenario, Style } from "./scenarios.ts"

/** One test's outcome in one run. */
export interface TestOutcome {
  readonly scenario: Scenario
  readonly status: "passed" | "failed" | "flaky" | "skipped"
  readonly ms: number
  readonly calls: number
  readonly usd: number
}

/** A style's suite run on the correct app: the first run (recording) and the replay of it. */
export interface StyleRuns {
  readonly style: Style
  readonly first: readonly TestOutcome[]
  /** Absent when the style was not replayed (no recordings to replay). */
  readonly replay?: readonly TestOutcome[]
}

/** A planted bug run against one style's test for the scenario it must break. */
export interface BugRun {
  readonly bug: Bug
  readonly style: Style
  readonly scenario: Scenario
  /** The scenario's test failed, as it should with the bug in. */
  readonly caught: boolean
}

/** `danwo matrix` over the checkout test, with one provider bug in (or none). */
export interface MatrixRunResult {
  readonly bug: Bug | null
  readonly failed: number
  readonly lintErrors: number
  readonly ms: number
}

export interface StyleMetrics {
  readonly style: Style
  readonly scenarios: number
  readonly passed: number
  /** Scenarios the style cannot express, skipped rather than counted. */
  readonly skipped: number
  /** Tests that failed on the correct app. */
  readonly falseFailures: number
  readonly passRate: number
  readonly bugsCaught: number
  readonly bugsRun: number
  readonly catchRate: number
  readonly firstRun: { readonly calls: number; readonly usd: number; readonly msPerTest: number }
  readonly replay?: { readonly calls: number; readonly passed: number; readonly msPerTest: number }
}

export interface MatrixMetrics {
  readonly bugs: number
  readonly caught: number
  readonly catchRate: number
  /** Faulted runs that failed on the correct app. */
  readonly falseFailures: number
  readonly byBug: readonly { readonly bug: Bug; readonly caught: boolean; readonly how: string }[]
}

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)

const isPass = (outcome: TestOutcome) => outcome.status === "passed" || outcome.status === "flaky"

function sum(outcomes: readonly TestOutcome[], pick: (outcome: TestOutcome) => number) {
  return outcomes.reduce((total, outcome) => total + pick(outcome), 0)
}

function averageMs(outcomes: readonly TestOutcome[]): number {
  const ran = outcomes.filter((outcome) => outcome.status !== "skipped")

  return Math.round(
    ratio(
      sum(ran, (outcome) => outcome.ms),
      ran.length,
    ),
  )
}

function replayMetrics(replay: readonly TestOutcome[]) {
  return {
    calls: sum(replay, (outcome) => outcome.calls),
    passed: replay.filter(isPass).length,
    msPerTest: averageMs(replay),
  }
}

export function styleMetrics(runs: StyleRuns, bugs: readonly BugRun[]): StyleMetrics {
  const first = runs.first
  const skipped = first.filter((outcome) => outcome.status === "skipped").length
  const ran = first.length - skipped
  const passed = first.filter(isPass).length
  const mine = bugs.filter((run) => run.style === runs.style)
  const caught = mine.filter((run) => run.caught).length

  return {
    style: runs.style,
    scenarios: first.length,
    passed,
    skipped,
    falseFailures: ran - passed,
    passRate: ratio(passed, ran),
    bugsCaught: caught,
    bugsRun: mine.length,
    catchRate: ratio(caught, mine.length),
    firstRun: {
      calls: sum(first, (outcome) => outcome.calls),
      usd: sum(first, (outcome) => outcome.usd),
      msPerTest: averageMs(first),
    },
    ...(runs.replay && { replay: replayMetrics(runs.replay) }),
  }
}

/** How a provider bug was caught: a failed faulted run, a lint error, both, or not at all. */
function howCaught(run: MatrixRunResult): string {
  const ways = [
    ...(run.failed > 0 ? [`${run.failed} faulted run(s) failed`] : []),
    ...(run.lintErrors > 0 ? [`${run.lintErrors} lint error(s)`] : []),
  ]

  return ways.length === 0 ? "missed" : ways.join(" and ")
}

export function matrixMetrics(runs: readonly MatrixRunResult[]): MatrixMetrics {
  const correct = runs.find((run) => run.bug === null)
  const byBug = runs.flatMap((run) =>
    run.bug === null
      ? []
      : [{ bug: run.bug, caught: run.failed > 0 || run.lintErrors > 0, how: howCaught(run) }],
  )
  const caught = byBug.filter((entry) => entry.caught).length

  return {
    bugs: byBug.length,
    caught,
    catchRate: ratio(caught, byBug.length),
    falseFailures: correct?.failed ?? 0,
    byBug,
  }
}
