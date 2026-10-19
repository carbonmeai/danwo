/**
 * Every test across the history, one row each: how often it ran and passed, how flaky it is, how
 * long it takes and what it costs, and under the matrix which faults break it. A run counts as
 * flaky when the test passed only on a retry, or when the same commit saw it both pass and fail.
 */
import type { HistoryTest, MatrixHistory, RunHistory, TestHistory } from "@danwo/runner/runner"

/** One fault that broke a test under the matrix, and in how many matrix runs. */
export interface BreakingFault {
  readonly fault: string
  readonly runs: number
}

export interface TestBreakdown {
  readonly id: string
  /** `danwo test` runs that ran it. */
  readonly runs: number
  /** Share of those runs it passed (on the first try or a retry); null when it never ran. */
  readonly passRate: number | null
  /** Share of those runs that were flaky; null when it never ran. */
  readonly flakeRate: number | null
  readonly medianMs: number | null
  readonly costUsd: number
  /** The latest run that ran it, test or matrix. */
  readonly lastRun: string
  readonly lastStatus: string
  /** `danwo matrix` runs of it. */
  readonly matrixRuns: number
  /** The faults that failed it in those runs, most often first. */
  readonly breakingFaults: readonly BreakingFault[]
}

/** What the table can be sorted by. */
const BREAKDOWN_SORTS = ["flake", "pass", "runs", "time", "spend", "faults"] as const

export type BreakdownSort = (typeof BREAKDOWN_SORTS)[number]

const PASSED = new Set(["passed", "flaky"])
const FAILED = new Set(["failed", "timed-out", "interrupted"])

interface Seen {
  readonly run: TestHistory
  readonly test: HistoryTest
}

function median(values: readonly number[]): number | null {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length === 0) return null

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** Commits on which the test both passed and failed. */
function mixedCommits(seen: readonly Seen[]): Set<string> {
  const outcomes = new Map<string, Set<boolean>>()

  for (const { run, test } of seen) {
    if (run.commit === undefined || (!PASSED.has(test.status) && !FAILED.has(test.status))) continue

    outcomes.set(run.commit, (outcomes.get(run.commit) ?? new Set()).add(PASSED.has(test.status)))
  }

  return new Set([...outcomes].flatMap(([commit, kinds]) => (kinds.size > 1 ? [commit] : [])))
}

function isFlaky(seen: Seen, mixed: Set<string>): boolean {
  return (
    seen.test.status === "flaky" || (seen.run.commit !== undefined && mixed.has(seen.run.commit))
  )
}

const spentOf = (test: HistoryTest) =>
  test.attempts.reduce((sum, attempt) => sum + (attempt.usage?.spent.usd ?? 0), 0)

const timeOf = (test: HistoryTest) =>
  test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)

/** The faults that failed the test across its matrix runs, most often first. */
function breakingFaults(matrices: readonly MatrixHistory[]): BreakingFault[] {
  const counts = new Map<string, number>()

  for (const run of matrices)
    for (const trial of run.trials)
      if (trial.status === "failed" && trial.fault !== null)
        counts.set(trial.fault, (counts.get(trial.fault) ?? 0) + 1)

  return [...counts]
    .map(([fault, runs]) => ({ fault, runs }))
    .toSorted((a, b) => b.runs - a.runs || a.fault.localeCompare(b.fault))
}

/** The test's latest run and its verdict there, from its test runs and matrix runs, newest first. */
function latest(seen: readonly Seen[], matrices: readonly MatrixHistory[]) {
  const fromTests = seen.at(-1)
  const fromMatrix = matrices[0]
  const testAt = fromTests?.run.startedAt ?? ""

  if (fromMatrix !== undefined && fromMatrix.startedAt > testAt)
    return {
      lastRun: fromMatrix.id,
      lastStatus: fromMatrix.trials.some((t) => t.status === "failed")
        ? "failed"
        : fromMatrix.clean.status,
    }

  return { lastRun: fromTests?.run.id ?? "", lastStatus: fromTests?.test.status ?? "" }
}

/** One test's row from its test runs (oldest first) and matrix runs (newest first). */
function rowOf(
  id: string,
  seen: readonly Seen[],
  matrices: readonly MatrixHistory[],
): TestBreakdown {
  const mixed = mixedCommits(seen)
  const runs = seen.length

  return {
    id,
    runs,
    passRate: runs === 0 ? null : seen.filter((s) => PASSED.has(s.test.status)).length / runs,
    flakeRate: runs === 0 ? null : seen.filter((s) => isFlaky(s, mixed)).length / runs,
    medianMs: median(seen.map((s) => timeOf(s.test))),
    costUsd: seen.reduce((sum, s) => sum + spentOf(s.test), 0),
    ...latest(seen, matrices),
    matrixRuns: matrices.length,
    breakingFaults: breakingFaults(matrices),
  }
}

/** Every test the history knows, from `runs` newest first. */
export function testBreakdown(runs: readonly RunHistory[]): TestBreakdown[] {
  const tests = new Map<string, Seen[]>()
  const matrices = new Map<string, MatrixHistory[]>()

  for (const run of runs.toReversed()) {
    if (run.kind === "matrix") continue

    for (const test of run.tests) tests.set(test.id, [...(tests.get(test.id) ?? []), { run, test }])
  }

  for (const run of runs)
    if (run.kind === "matrix") matrices.set(run.testId, [...(matrices.get(run.testId) ?? []), run])

  const ids = new Set([...tests.keys(), ...matrices.keys()])

  return [...ids].map((id) => rowOf(id, tests.get(id) ?? [], matrices.get(id) ?? []))
}

/** What each sort orders by; larger first. */
const SORT_VALUE: Readonly<Record<BreakdownSort, (row: TestBreakdown) => number>> = {
  flake: (row) => row.flakeRate ?? -1,
  pass: (row) => row.passRate ?? -1,
  runs: (row) => row.runs + row.matrixRuns,
  time: (row) => row.medianMs ?? -1,
  spend: (row) => row.costUsd,
  faults: (row) => row.breakingFaults.length,
}

/** The rows by `sort`, largest first unless `ascending`; ties by id. */
export function sortBreakdown(
  rows: readonly TestBreakdown[],
  sort: BreakdownSort,
  ascending = false,
): TestBreakdown[] {
  const value = SORT_VALUE[sort]
  const sign = ascending ? 1 : -1

  return rows.toSorted((a, b) => sign * (value(a) - value(b)) || a.id.localeCompare(b.id))
}

export function isBreakdownSort(value: unknown): value is BreakdownSort {
  return typeof value === "string" && (BREAKDOWN_SORTS as readonly string[]).includes(value)
}
