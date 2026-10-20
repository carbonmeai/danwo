/**
 * Runs as the dashboard lists them: every `danwo test` and `danwo matrix` the project's history
 * holds, newest first, with the counts and cost each row shows, and one run in full with the
 * flight records it kept.
 */
import { join } from "node:path"

import {
  DEFAULT_KEEP_RUNS,
  type MatrixHistory,
  type RunHistory,
  type TestHistory,
  type Usage,
  type Verdict,
} from "@danwo/runner/runner"
import { verdictCounts, verdictSummary } from "@danwo/runner/verdict"

import { danwoDir, entries, isVersioned, readJson } from "../../lib/project-files.ts"
import { hasVerdict, runVerdicts } from "../../lib/whose.ts"
import { type Health, healthOf } from "./run-trend.ts"

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
  /** It kept recordings, but they were deleted with the runs past `record.keepRuns`. */
  readonly pruned: boolean
  /** Its failures by verdict, such as "2 app bugs · 1 test issue"; empty when none failed. */
  readonly whose: string
  /** The verdict most of its failures share, app bugs first on a tie. */
  readonly topVerdict?: Verdict
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

/** The run folders still under `.danwo/runs`. */
async function runsOnDisk(root: string): Promise<ReadonlySet<string>> {
  return new Set(await entries(join(danwoDir(root), "runs")))
}

/** Whether the run kept recordings that have since been deleted. */
function isPruned(run: RunHistory, onDisk: ReadonlySet<string>): boolean {
  return run.run !== undefined && !onDisk.has(run.run)
}

/** How many runs keep their recordings: what the newest run that says was told, else 50. */
export function keepRunsOf(history: readonly RunHistory[]): number {
  return history.find((run) => run.keepRuns !== undefined)?.keepRuns ?? DEFAULT_KEEP_RUNS
}

function usageTotals(usage: Usage): Pick<RunRow, "costUsd" | "modelCalls"> {
  return { costUsd: usage.spent.usd, modelCalls: usage.spent.calls }
}

/** A run's failures by verdict, for its row. */
function whoseOf(run: RunHistory): Pick<RunRow, "whose" | "topVerdict"> {
  const verdicts = runVerdicts(run)
  const top = verdictCounts(verdicts).toSorted((a, b) => b.count - a.count)[0]

  return {
    whose: verdictSummary(verdicts),
    ...(top !== undefined && { topVerdict: top.verdict }),
  }
}

function testRow(run: TestHistory): Pick<RunRow, "kind" | "title" | "counts"> {
  const count = run.tests.length

  return {
    kind: "test",
    title: `${count} ${count === 1 ? "test" : "tests"}`,
    counts: countOf(run.tests.map((test) => test.status)),
  }
}

function matrixRow(run: MatrixHistory): Pick<RunRow, "kind" | "title" | "counts"> {
  return {
    kind: "matrix",
    title: run.testId,
    counts: countOf(run.trials.map((trial) => trial.status)),
  }
}

function rowOf(run: RunHistory, onDisk: ReadonlySet<string> = new Set()): RunRow {
  return {
    id: run.id,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    ...(run.kind === "test" ? testRow(run) : matrixRow(run)),
    ...usageTotals(run.usage),
    recorded: run.run !== undefined,
    pruned: isPruned(run, onDisk),
    ...whoseOf(run),
  }
}

/** A page of the runs list, newest first. */
export interface RunPage {
  readonly rows: readonly RunRow[]
  readonly total: number
  /** The recent runs' pass rate, flakiness, failures and spend, with their trend. */
  readonly health: Health
  /** How many of the newest runs keep their recordings. */
  readonly keepRuns: number
}

/** The two kinds of run: `danwo test` runs many tests once, `danwo matrix` one test per fault. */
export type RunKind = RunHistory["kind"]

/** Which runs the list shows: of one kind, passing or failing, since a time or on one day. */
export interface RunFilter {
  readonly kind?: RunKind | undefined
  readonly status?: "passed" | "failed" | undefined
  /** Only runs started within this many days. */
  readonly days?: number | undefined
  /** Only runs started on this `YYYY-MM-DD` (UTC). */
  readonly day?: string | undefined
  /** Only runs with a failure of this verdict. */
  readonly verdict?: Verdict | undefined
}

function matches(run: RunHistory, filter: RunFilter, now: number): boolean {
  const failed = rowOf(run).counts.failed > 0

  return (
    (filter.kind === undefined || run.kind === filter.kind) &&
    (filter.status === undefined || (filter.status === "failed") === failed) &&
    (filter.days === undefined || Date.parse(run.startedAt) >= now - filter.days * 86_400_000) &&
    (filter.day === undefined || run.startedAt.startsWith(filter.day)) &&
    hasVerdict(run, filter.verdict)
  )
}

/** A page of the runs the filter keeps, newest first, with how many of each kind there are. */
export async function listRuns(
  root: string,
  page = 0,
  size = 50,
  filter: RunFilter = {},
  now = Date.now(),
): Promise<RunPage & { readonly counts: Readonly<Record<RunKind, number>> }> {
  const [all, onDisk] = await Promise.all([loadHistory(root), runsOnDisk(root)])
  const runs = all.filter((run) => matches(run, filter, now))
  const matrix = all.filter((run) => run.kind === "matrix").length

  return {
    rows: runs.slice(page * size, (page + 1) * size).map((run) => rowOf(run, onDisk)),
    total: runs.length,
    health: healthOf(all),
    keepRuns: keepRunsOf(all),
    counts: { test: all.length - matrix, matrix },
  }
}

/** One run in full, or undefined when the history has no run with that id. */
export async function getRun(root: string, id: string): Promise<RunHistory | undefined> {
  const runs = await loadHistory(root)

  return runs.find((run) => run.id === id)
}

/** What a run's page needs of its recordings: whether they were deleted, and how many runs keep theirs. */
export interface RunRecordings {
  readonly pruned: boolean
  readonly keepRuns: number
}

/** One run in full with whether its recordings are still on disk, or undefined when unknown. */
export async function getRunWithRecordings(
  root: string,
  id: string,
): Promise<{ readonly run: RunHistory; readonly recordings: RunRecordings } | undefined> {
  const [runs, onDisk] = await Promise.all([loadHistory(root), runsOnDisk(root)])
  const run = runs.find((each) => each.id === id)

  return (
    run && {
      run,
      recordings: { pruned: isPruned(run, onDisk), keepRuns: keepRunsOf(runs) },
    }
  )
}

/** Where a recording came from, for one whose run was deleted: its test, when, and which run. */
export interface RecordingOrigin {
  readonly testId: string
  readonly startedAt: string
  readonly runId: string
  readonly keepRuns: number
}

/** The record folders a run's summary names, with the test each belongs to. */
function recordsIn(run: RunHistory): (readonly [string, string])[] {
  if (run.kind === "matrix")
    return [run.clean, ...run.trials].flatMap((trial) =>
      trial.record === undefined ? [] : [[trial.record, run.testId] as const],
    )

  return run.tests.flatMap((test) =>
    test.attempts.flatMap((attempt) =>
      attempt.record === undefined ? [] : [[attempt.record, test.id] as const],
    ),
  )
}

/** Which run and test a recording folder belonged to, from the history; undefined when unknown. */
export async function recordingOrigin(
  root: string,
  dir: string,
): Promise<RecordingOrigin | undefined> {
  const runs = await loadHistory(root)

  for (const run of runs) {
    const found = recordsIn(run).find(([record]) => record === dir)

    if (found !== undefined)
      return {
        testId: found[1],
        startedAt: run.startedAt,
        runId: run.id,
        keepRuns: keepRunsOf(runs),
      }
  }

  return undefined
}
