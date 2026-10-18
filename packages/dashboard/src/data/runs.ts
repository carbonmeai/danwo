/**
 * Runs as the dashboard lists them: every `danwo test` and `danwo matrix` the project's history
 * holds, newest first, with the counts and cost each row shows, and one run in full with the
 * flight records it kept.
 */
import { join } from "node:path"

import type { MatrixHistory, RunHistory, TestHistory, Usage } from "@danwo/runner/runner"

import { danwoDir, entries, isVersioned, readJson } from "./files.ts"
import { type Health, healthOf } from "./trend.ts"

/** The statuses a row counts; tests and matrix trials share the words. */
export interface RunCounts {
  readonly passed: number
  readonly failed: number
  readonly flaky: number
  readonly skipped: number
  readonly notJudged: number
  readonly invalid: number
}

/** One row of the runs list. */
export interface RunRow {
  readonly id: string
  readonly kind: "test" | "matrix"
  readonly startedAt: string
  readonly durationMs: number
  /** What ran: the matrix's test, or how many tests. */
  readonly title: string
  readonly counts: RunCounts
  readonly costUsd: number
  readonly modelCalls: number
  readonly recorded: boolean
}

const NONE: RunCounts = { passed: 0, failed: 0, flaky: 0, skipped: 0, notJudged: 0, invalid: 0 }

/** Which count a status adds to. */
const COUNTED: Readonly<Record<string, keyof RunCounts>> = {
  passed: "passed",
  failed: "failed",
  "timed-out": "failed",
  interrupted: "failed",
  "environment-error": "failed",
  flaky: "flaky",
  skipped: "skipped",
  "not-judged": "notJudged",
  invalid: "invalid",
}

function countOf(statuses: readonly string[]): RunCounts {
  return statuses.reduce<RunCounts>((counts, status) => {
    const key = COUNTED[status]

    return key === undefined ? counts : { ...counts, [key]: counts[key] + 1 }
  }, NONE)
}

function isRunHistory(value: unknown): value is RunHistory {
  return (
    isVersioned(value) &&
    "kind" in value &&
    (value.kind === "test" || value.kind === "matrix") &&
    "id" in value &&
    typeof value.id === "string"
  )
}

function historyFolder(root: string): string {
  return join(danwoDir(root), "history")
}

/** Every run summary in the history, newest first. */
export async function loadHistory(root: string): Promise<RunHistory[]> {
  const dir = historyFolder(root)
  const names = (await entries(dir)).filter((name) => name.endsWith(".json"))
  const loaded = await Promise.all(names.map((name) => readJson(join(dir, name))))

  return loaded.filter(isRunHistory).toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))
}

function usageTotals(usage: Usage): Pick<RunRow, "costUsd" | "modelCalls"> {
  return { costUsd: usage.spent.usd, modelCalls: usage.spent.calls }
}

function testRow(run: TestHistory): RunRow {
  const count = run.tests.length

  return {
    id: run.id,
    kind: "test",
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    title: `${count} ${count === 1 ? "test" : "tests"}`,
    counts: countOf(run.tests.map((test) => test.status)),
    ...usageTotals(run.usage),
    recorded: run.run !== undefined,
  }
}

function matrixRow(run: MatrixHistory): RunRow {
  return {
    id: run.id,
    kind: "matrix",
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    title: run.testId,
    counts: countOf(run.trials.map((trial) => trial.status)),
    ...usageTotals(run.usage),
    recorded: run.run !== undefined,
  }
}

function rowOf(run: RunHistory): RunRow {
  return run.kind === "test" ? testRow(run) : matrixRow(run)
}

/** A page of the runs list, newest first. */
export interface RunPage {
  readonly rows: readonly RunRow[]
  readonly total: number
  /** The recent runs' pass rate, flakiness, failures and spend, with their trend. */
  readonly health: Health
}

export async function listRuns(root: string, page = 0, size = 50): Promise<RunPage> {
  const runs = await loadHistory(root)

  return {
    rows: runs.slice(page * size, (page + 1) * size).map(rowOf),
    total: runs.length,
    health: healthOf(runs),
  }
}

/** One run in full, or undefined when the history has no run with that id. */
export async function getRun(root: string, id: string): Promise<RunHistory | undefined> {
  const runs = await loadHistory(root)

  return runs.find((run) => run.id === id)
}
