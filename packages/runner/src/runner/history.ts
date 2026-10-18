/**
 * Run history: one small summary per `danwo test` and `danwo matrix` run under `.danwo/history/`,
 * kept whatever the record mode, so the dashboard can list every run, follow a test across runs
 * and open a run's flight records. Summaries carry no request bodies, and every message in them
 * passes through the credential redactor, so they hold nothing the flight records would not.
 */
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

import type { PlannedFault, RunOutcome } from "@danwo/matrix"

import type { LintFinding, LintSeverity } from "../lint/index.ts"
import { addUsage, type Usage } from "../record/usage.ts"
import { redactCredentials } from "../secrets/index.ts"
import type { MatrixRunReport, Reporter, RunContext, TestRunReport } from "./reporting.ts"
import type { AttemptReport, TestReport } from "./tasks.ts"

/** History summaries kept; older ones are deleted when a run is added. */
const KEEP = 200

/** An error as a summary keeps it: its code and redacted first line. */
export interface HistoryError {
  readonly code: string
  readonly class: string
  readonly message: string
  readonly source?: { readonly file: string; readonly line: number }
}

/** How often one lint rule fired in an attempt or a matrix run, at one severity. */
export interface HistoryLint {
  readonly rule: string
  readonly severity: LintSeverity
  readonly count: number
}

export interface HistoryAttempt {
  readonly status: string
  readonly durationMs: number
  readonly error?: HistoryError
  /** The attempt's flight record directory, relative to the project root, when it was kept. */
  readonly record?: string
  readonly usage?: Usage
  /** What the integration lint found, counted by rule; absent when it found nothing. */
  readonly lint?: readonly HistoryLint[]
}

export interface HistoryTest {
  readonly id: string
  readonly status: string
  readonly attempts: readonly HistoryAttempt[]
}

export interface HistoryTrial {
  /** The fault's label; null for the clean run. */
  readonly fault: string | null
  /** What the fault landed on: a call, a webhook, or a race (`page`, `users`, `redirect`). */
  readonly target: PlannedFault["target"] | null
  readonly status: RunOutcome["status"]
  readonly error?: string
  readonly notes: readonly string[]
  readonly record?: string
  readonly source?: { readonly file: string; readonly line: number }
  readonly calls: number
  readonly deliveries: number
}

interface HistoryBase {
  readonly version: 1
  readonly id: string
  readonly startedAt: string
  readonly durationMs: number
  /** The run's flight-record folder name under `.danwo/runs`, when anything was kept. */
  readonly run?: string
  readonly usage: Usage
}

export interface TestHistory extends HistoryBase {
  readonly kind: "test"
  readonly tests: readonly HistoryTest[]
  readonly brokenFiles: readonly { readonly file: string; readonly error: string }[]
}

export interface MatrixHistory extends HistoryBase {
  readonly kind: "matrix"
  /** What the integration lint found across the trials, counted by rule. */
  readonly lint?: readonly HistoryLint[]
  readonly testId: string
  readonly file: string
  readonly clean: HistoryTrial
  readonly trials: readonly HistoryTrial[]
}

export type RunHistory = TestHistory | MatrixHistory

export function historyDir(root: string): string {
  return join(root, ".danwo", "history")
}

/** Findings counted by rule and severity, in a stable order. */
function lintCounts(findings: readonly LintFinding[]): HistoryLint[] {
  const counts = new Map<string, HistoryLint>()

  for (const finding of findings) {
    const key = `${finding.severity} ${finding.rule}`
    const seen = counts.get(key)

    counts.set(key, {
      rule: finding.rule,
      severity: finding.severity,
      count: (seen?.count ?? 0) + 1,
    })
  }

  return [...counts.values()].toSorted((a, b) => a.rule.localeCompare(b.rule))
}

/** A redacted one-line message. */
function line(text: string): string {
  return redactCredentials(text.split("\n")[0] ?? "").slice(0, 500)
}

/** A path the run reported relative to its cwd, made relative to the project root. */
function fromRoot(context: RunContext, path: string | undefined): string | undefined {
  return path === undefined ? undefined : relative(context.root, resolve(context.cwd, path))
}

function attemptOf(context: RunContext, attempt: AttemptReport): HistoryAttempt {
  const record = fromRoot(context, attempt.record)
  const { error } = attempt

  return {
    status: attempt.status,
    durationMs: attempt.durationMs,
    ...(error && {
      error: {
        code: error.code,
        class: error.class,
        message: line(error.message),
        ...(error.source && { source: error.source }),
      },
    }),
    ...(record !== undefined && { record }),
    ...(attempt.usage && { usage: attempt.usage }),
    ...(attempt.lint?.length && { lint: lintCounts(attempt.lint) }),
  }
}

function testOf(context: RunContext, report: TestReport): HistoryTest {
  return {
    id: report.id,
    status: report.status,
    attempts: report.attempts.map((attempt) => attemptOf(context, attempt)),
  }
}

function trialOf(context: RunContext, outcome: RunOutcome): HistoryTrial {
  const record = fromRoot(context, outcome.record)

  return {
    fault: outcome.fault?.label ?? null,
    target: outcome.fault?.target ?? null,
    status: outcome.status,
    ...(outcome.error !== null && { error: line(outcome.error) }),
    notes: outcome.notes.map(line),
    ...(record !== undefined && { record }),
    ...(outcome.source && { source: outcome.source }),
    calls: outcome.exchanges.length,
    deliveries: outcome.deliveries.length,
  }
}

/** The run's id and when it began, from its record folder when it has one. */
function identity(durationMs: number, run: string | undefined) {
  const startedAt = new Date(Date.now() - durationMs).toISOString()
  const stamp = startedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15)

  return { id: run ?? `${stamp}-${randomBytes(2).toString("hex")}`, startedAt }
}

function usageOfTests(reports: readonly TestReport[]): Usage {
  return addUsage(
    reports.flatMap((report) => report.attempts.flatMap((attempt) => attempt.usage ?? [])),
  )
}

/** The summary of a `danwo test` run. */
function testHistory(run: TestRunReport): TestHistory {
  return {
    version: 1,
    kind: "test",
    ...identity(run.durationMs, run.run),
    durationMs: run.durationMs,
    ...(run.run !== undefined && { run: run.run }),
    usage: usageOfTests(run.reports),
    tests: run.reports.map((report) => testOf(run, report)),
    brokenFiles: run.brokenFiles.map((broken) => ({
      file: broken.file,
      error: line(broken.error),
    })),
  }
}

/** The run folder a report path such as `.danwo/runs/<run>/report.html` names. */
function runOf(reportPath: string | undefined): string | undefined {
  return reportPath?.split(/[\\/]/).at(-2)
}

/** The summary of a `danwo matrix` run. */
function matrixHistory(run: MatrixRunReport): MatrixHistory {
  const folder = runOf(run.reportPath)

  return {
    version: 1,
    kind: "matrix",
    ...identity(run.durationMs, folder),
    durationMs: run.durationMs,
    ...(folder !== undefined && { run: folder }),
    usage: run.usage ?? addUsage([]),
    testId: run.testId,
    file: run.file,
    clean: trialOf(run, run.result.clean),
    trials: run.result.runs.map((outcome) => trialOf(run, outcome)),
    ...(run.lint?.length && { lint: lintCounts(run.lint.flatMap((trial) => trial.findings)) }),
  }
}

async function prune(dir: string): Promise<void> {
  const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json"))

  for (const old of files.toSorted().toReversed().slice(KEEP))
    await rm(join(dir, old), { force: true })
}

async function keep(root: string, summary: RunHistory): Promise<void> {
  const dir = historyDir(root)

  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${summary.id}.json`), `${JSON.stringify(summary)}\n`)
  await prune(dir)
}

/** The reporter every run has: it adds the run's summary to the project's history. */
export function historyReporter(): Reporter {
  return {
    name: "history",
    testsFinished: (run) => keep(run.root, testHistory(run)),
    matrixFinished: (run) => keep(run.root, matrixHistory(run)),
  }
}
