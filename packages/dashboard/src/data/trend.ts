/**
 * The project's health over its recent runs: how often things passed, how long runs took and what
 * they cost, as the runs page's summary and sparklines draw them.
 */
import type { RunHistory, Usage } from "@danwo/runner/runner"

/** One run as the sparklines plot it, oldest first. */
export interface TrendPoint {
  readonly id: string
  readonly kind: "test" | "matrix"
  readonly startedAt: string
  /** Share of judged tests or trials that passed, 0 to 1; null when nothing was judged. */
  readonly passRate: number | null
  readonly durationMs: number
  readonly costUsd: number
  readonly failed: boolean
}

/** The headline numbers over the window of recent runs. */
export interface Health {
  /** How many recent runs the numbers cover. */
  readonly window: number
  /** Passed tests and trials over everything judged, 0 to 1; null when nothing was judged. */
  readonly passRate: number | null
  /** Tests that passed only on a retry, across the window. */
  readonly flaky: number
  /** Runs in the window with at least one failure. */
  readonly failedRuns: number
  readonly costUsd: number
  readonly modelCalls: number
  /** Share of agent steps the replay cache answered without the model; null with no agent steps. */
  readonly cacheHitRate: number | null
  readonly points: readonly TrendPoint[]
}

const PASSING = new Set(["passed", "flaky"])
const JUDGED = new Set(["passed", "flaky", "failed", "timed-out", "interrupted"])

/** The statuses a run judged: its tests, or its matrix's clean run and trials. */
function statusesOf(run: RunHistory): string[] {
  return run.kind === "test"
    ? run.tests.map((test) => test.status)
    : [run.clean, ...run.trials].map((trial) => trial.status)
}

/** Replayed or relocated agent steps over every agent step the cache saw. */
export function cacheHitRate(usage: Usage): number | null {
  const counts = Object.entries(usage.cache)
  const total = counts.reduce((sum, [, n]) => sum + (n ?? 0), 0)
  const hits = counts
    .filter(([outcome]) => outcome === "replayed" || outcome === "relocated")
    .reduce((sum, [, n]) => sum + (n ?? 0), 0)

  return total === 0 ? null : hits / total
}

function pointOf(run: RunHistory): TrendPoint {
  const judged = statusesOf(run).filter((status) => JUDGED.has(status))
  const passed = judged.filter((status) => PASSING.has(status)).length

  return {
    id: run.id,
    kind: run.kind,
    startedAt: run.startedAt,
    passRate: judged.length === 0 ? null : passed / judged.length,
    durationMs: run.durationMs,
    costUsd: run.usage.spent.usd,
    failed: passed < judged.length,
  }
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0)
}

/** The health of the `window` most recent runs; `runs` comes newest first. */
export function healthOf(runs: readonly RunHistory[], window = 20): Health {
  const recent = runs.slice(0, window)
  const statuses = recent.flatMap(statusesOf).filter((status) => JUDGED.has(status))
  const passed = statuses.filter((status) => PASSING.has(status)).length
  const hitRates = recent.map((run) => cacheHitRate(run.usage)).filter((rate) => rate !== null)

  return {
    window: recent.length,
    passRate: statuses.length === 0 ? null : passed / statuses.length,
    flaky: statuses.filter((status) => status === "flaky").length,
    failedRuns: recent.map(pointOf).filter((point) => point.failed).length,
    costUsd: sumOf(recent.map((run) => run.usage.spent.usd)),
    modelCalls: sumOf(recent.map((run) => run.usage.spent.calls)),
    cacheHitRate: hitRates.length === 0 ? null : sumOf(hitRates) / hitRates.length,
    points: recent.map(pointOf).toReversed(),
  }
}
