/**
 * The project at a glance over a window of days: its pass rate, how many runs and failed tests,
 * how long runs take, each against the window before; runs per day; the latest failing runs; and
 * the tests the fault matrix broke.
 */
import type { MatrixHistory, RunHistory } from "@danwo/runner/runner"

import { matrixVerdict } from "../tests/tests-data.ts"

/** How many days the overview covers. */
export const RANGES = [7, 30, 90] as const

export type Range = (typeof RANGES)[number]

/** The range `value` names, from an address or a select, if it is one. */
export function rangeOf(value: unknown): Range | undefined {
  return RANGES.find((range) => range === Number(value))
}

/** A figure now and over the window before, to show the change. */
export interface Figure {
  readonly now: number | null
  readonly prior: number | null
}

/** One day of runs: how many passed outright and how many had a failure. */
export interface Day {
  /** `YYYY-MM-DD`, in UTC. */
  readonly day: string
  readonly passed: number
  readonly failed: number
  /** Passed over judged, 0 to 1; null on a day with nothing judged. */
  readonly passRate: number | null
  /** The day's mean run time; null on a day with no runs. */
  readonly meanMs: number | null
}

export interface FailingRun {
  readonly id: string
  readonly kind: RunHistory["kind"]
  readonly title: string
  readonly startedAt: string
  readonly failed: number
}

export interface BrokenTest {
  readonly id: string
  readonly runId: string
  readonly faults: readonly string[]
}

export interface Overview {
  readonly range: Range
  readonly passRate: Figure
  readonly runs: Figure
  readonly failedTests: Figure
  readonly meanMs: Figure
  readonly days: readonly Day[]
  readonly failing: readonly FailingRun[]
  readonly broken: readonly BrokenTest[]
}

const DAY_MS = 86_400_000
const PASSING = new Set(["passed", "flaky"])
const FAILING = new Set(["failed", "timed-out", "interrupted"])

/** The statuses a run judged: its tests, or its matrix's clean run and trials. */
function verdicts(run: RunHistory): string[] {
  return run.kind === "test"
    ? run.tests.map((test) => test.status)
    : [run.clean, ...run.trials].map((trial) => trial.status)
}

function failedIn(run: RunHistory): number {
  return verdicts(run).filter((status) => FAILING.has(status)).length
}

function passRateOf(runs: readonly RunHistory[]): number | null {
  const judged = runs.flatMap(verdicts).filter((s) => PASSING.has(s) || FAILING.has(s))

  return judged.length === 0 ? null : judged.filter((s) => PASSING.has(s)).length / judged.length
}

function meanOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Tests that failed in a run of the window, counted once each. */
function failedTestsIn(runs: readonly RunHistory[]): number {
  const ids = runs.flatMap((run) =>
    run.kind === "test"
      ? run.tests.filter((test) => FAILING.has(test.status)).map((test) => test.id)
      : FAILING.has(run.clean.status)
        ? [run.testId]
        : [],
  )

  return new Set(ids).size
}

function figure<T>(
  now: readonly T[],
  prior: readonly T[],
  of: (runs: readonly T[]) => number | null,
): Figure {
  return { now: of(now), prior: prior.length === 0 ? null : of(prior) }
}

function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

/** Every day of the window, oldest first, with its runs counted. */
function daysOf(runs: readonly RunHistory[], range: Range, now: number): Day[] {
  return Array.from({ length: range }, (_, i) => {
    const day = dayOf(new Date(now - (range - 1 - i) * DAY_MS).toISOString())
    const onDay = runs.filter((run) => dayOf(run.startedAt) === day)
    const failed = onDay.filter((run) => failedIn(run) > 0).length

    return {
      day,
      passed: onDay.length - failed,
      failed,
      passRate: passRateOf(onDay),
      meanMs: meanOf(onDay.map((run) => run.durationMs)),
    }
  })
}

/** The newest matrix run of each test that some fault broke, with the faults that broke it. */
function brokenTests(runs: readonly RunHistory[]): BrokenTest[] {
  const matrices = runs.filter((run): run is MatrixHistory => run.kind === "matrix")
  const ids = [...new Set(matrices.map((run) => run.testId))]

  return ids.flatMap((id) => {
    const verdict = matrixVerdict(matrices.filter((run) => run.testId === id))

    return verdict.kind === "broke" ? [{ id, runId: verdict.runId, faults: verdict.broke }] : []
  })
}

/** The overview of the last `range` days before `now`, from `runs` newest first. */
export function overviewOf(runs: readonly RunHistory[], range: Range, now = Date.now()): Overview {
  const start = now - range * DAY_MS
  const inWindow = runs.filter((run) => Date.parse(run.startedAt) >= start)
  const before = runs.filter((run) => {
    const at = Date.parse(run.startedAt)

    return at < start && at >= start - range * DAY_MS
  })

  return {
    range,
    passRate: figure(inWindow, before, passRateOf),
    runs: figure(inWindow, before, (list) => list.length),
    failedTests: figure(inWindow, before, failedTestsIn),
    meanMs: figure(inWindow, before, (list) => meanOf(list.map((run) => run.durationMs))),
    days: daysOf(inWindow, range, now),
    failing: inWindow
      .filter((run) => failedIn(run) > 0)
      .slice(0, 5)
      .map((run) => ({
        id: run.id,
        kind: run.kind,
        title: run.kind === "matrix" ? run.testId : `${run.tests.length} tests`,
        startedAt: run.startedAt,
        failed: failedIn(run),
      })),
    broken: brokenTests(inWindow),
  }
}
