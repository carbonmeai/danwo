/**
 * Tests across runs: which ones flip between passing and failing, which are slowest and which cost
 * the most model money, from every `danwo test` run the history keeps.
 */
import type { HistoryLint, HistoryTest, RunHistory, TestHistory } from "@danwo/runner/runner"

import { loadHistory } from "./runs.ts"
import { cacheHitRate } from "./trend.ts"

/** One test's record over the runs that ran it. */
export interface TestInsight {
  readonly id: string
  readonly runs: number
  readonly passed: number
  readonly failed: number
  /** Runs where it passed only on a retry. */
  readonly flaky: number
  /** How often its outcome changed from one run to the next. */
  readonly flips: number
  readonly averageMs: number
  readonly costUsd: number
  readonly modelCalls: number
  /** The latest run that ran it. */
  readonly lastRun: string
  readonly lastStatus: string
}

/** One run's replay-cache hit rate, oldest run first. */
export interface CachePoint {
  readonly id: string
  readonly startedAt: string
  readonly rate: number
}

/** One integration lint rule, counted over every run that kept its findings. */
export interface LintRule {
  readonly rule: string
  readonly severity: HistoryLint["severity"]
  readonly count: number
  /** How many runs it fired in. */
  readonly runs: number
}

/** A test's outcome in one run, for the flakiness strip: oldest first. */
export interface Outcome {
  readonly run: string
  readonly status: string
}

export interface Insights {
  readonly flaky: readonly TestInsight[]
  readonly slowest: readonly TestInsight[]
  readonly costliest: readonly TestInsight[]
  readonly runs: number
  /** For each flaky test, its outcome in every run that ran it, oldest first. */
  readonly history: Readonly<Record<string, readonly Outcome[]>>
  readonly cache: readonly CachePoint[]
  readonly lint: readonly LintRule[]
}

interface Seen {
  readonly run: TestHistory
  readonly test: HistoryTest
}

const FAILED = new Set(["failed", "timed-out", "interrupted"])

function passedish(status: string): boolean {
  return status === "passed" || status === "flaky"
}

function spentOf(test: HistoryTest): { usd: number; calls: number } {
  return test.attempts.reduce(
    (sum, attempt) => ({
      usd: sum.usd + (attempt.usage?.spent.usd ?? 0),
      calls: sum.calls + (attempt.usage?.spent.calls ?? 0),
    }),
    { usd: 0, calls: 0 },
  )
}

function durationOf(test: HistoryTest): number {
  return test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)
}

function flipsOf(statuses: readonly string[]): number {
  return statuses
    .slice(1)
    .filter((status, i) => passedish(status) !== passedish(statuses[i] ?? status)).length
}

/** One test's insight from its appearances, oldest first. */
function insightOf(id: string, seen: readonly Seen[]): TestInsight {
  const statuses = seen.map((s) => s.test.status)
  const spent = seen.map((s) => spentOf(s.test))
  const last = seen.at(-1)

  return {
    id,
    runs: seen.length,
    passed: statuses.filter((status) => status === "passed").length,
    failed: statuses.filter((status) => FAILED.has(status)).length,
    flaky: statuses.filter((status) => status === "flaky").length,
    flips: flipsOf(statuses),
    averageMs: Math.round(seen.reduce((sum, s) => sum + durationOf(s.test), 0) / seen.length),
    costUsd: spent.reduce((sum, s) => sum + s.usd, 0),
    modelCalls: spent.reduce((sum, s) => sum + s.calls, 0),
    lastRun: last?.run.id ?? "",
    lastStatus: last?.test.status ?? "",
  }
}

/** Each test's appearances across the history, oldest run first. */
function appearances(runs: readonly TestHistory[]): Map<string, Seen[]> {
  const byTest = new Map<string, Seen[]>()

  for (const run of runs.toReversed())
    for (const test of run.tests)
      byTest.set(test.id, [...(byTest.get(test.id) ?? []), { run, test }])

  return byTest
}

/** Every run's replay-cache hit rate, for runs that had agent steps, oldest first. */
function cacheTrend(runs: readonly RunHistory[]): CachePoint[] {
  return runs.toReversed().flatMap((run) => {
    const rate = cacheHitRate(run.usage)

    return rate === null ? [] : [{ id: run.id, startedAt: run.startedAt, rate }]
  })
}

/** The lint counts a run kept: its attempts' for a test run, the run's own for a matrix. */
function lintOfRun(run: RunHistory): readonly HistoryLint[] {
  if (run.kind === "matrix") return run.lint ?? []

  return run.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.lint ?? []))
}

/** Lint rules by how often they fired across the runs, most first. */
function lintRules(runs: readonly RunHistory[]): LintRule[] {
  const rules = new Map<string, Omit<LintRule, "rule">>()

  for (const run of runs) {
    const counted = new Set<string>()

    for (const lint of lintOfRun(run)) {
      const rule = rules.get(lint.rule) ?? { severity: lint.severity, count: 0, runs: 0 }

      rules.set(lint.rule, {
        severity: lint.severity,
        count: rule.count + lint.count,
        runs: rule.runs + (counted.has(lint.rule) ? 0 : 1),
      })
      counted.add(lint.rule)
    }
  }

  return [...rules]
    .map(([rule, counted]) => ({ rule, ...counted }))
    .toSorted((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))
}

/** The flaky, slowest and costliest tests across the project's runs, at most `limit` each. */
export async function getInsights(root: string, limit = 50): Promise<Insights> {
  const history = await loadHistory(root)
  const runs = history.filter((run): run is TestHistory => run.kind === "test")
  const byTest = appearances(runs)
  const all = [...byTest].map(([id, appeared]) => insightOf(id, appeared))
  const flaky = all
    .filter((t) => t.flaky > 0 || t.flips > 0)
    .toSorted((a, b) => b.flaky + b.flips - (a.flaky + a.flips))
    .slice(0, limit)

  return {
    runs: runs.length,
    flaky,
    history: Object.fromEntries(
      flaky.map((t) => [
        t.id,
        (byTest.get(t.id) ?? []).map((s) => ({ run: s.run.id, status: s.test.status })),
      ]),
    ),
    cache: cacheTrend(history),
    lint: lintRules(history),
    slowest: all.toSorted((a, b) => b.averageMs - a.averageMs).slice(0, limit),
    costliest: all
      .filter((t) => t.costUsd > 0 || t.modelCalls > 0)
      .toSorted((a, b) => b.costUsd - a.costUsd)
      .slice(0, limit),
  }
}
