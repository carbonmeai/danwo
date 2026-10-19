/**
 * A run's summary in Markdown: the counts, a row per failing test or per fault, and where the
 * flight records are. It is the check run's output and the job summary alike.
 */
import type { RunOutcome } from "@danwo/matrix"
import {
  distinctFindings,
  type LintFinding,
  type MatrixRunReport,
  type TestReport,
  type TestRunReport,
} from "@danwo/runner/runner"

import { fileOfTestId, shown } from "./annotations.ts"

/** GitHub's limit on a check run's summary. */
const MAX_SUMMARY = 65_535

/** Where the run's flight records can be fetched from. */
export interface RecordsLink {
  /** The run's page; its artifacts are listed at the foot. */
  readonly runUrl: string
  /** The name the workflow uploads `.danwo/runs` under. */
  readonly artifact: string
}

export const STATUS_MARK: Readonly<Record<string, string>> = {
  passed: "✅",
  flaky: "⚠️",
  failed: "❌",
  "timed-out": "⏱️",
  interrupted: "⛔",
  skipped: "⏭️",
  invalid: "❔",
  "not-judged": "➖",
  "environment-error": "💥",
}

export const FAILED = new Set(["failed", "timed-out", "interrupted"])

/** A table cell: one line, pipes escaped, short. */
export function cell(text: string): string {
  return shown(text, 300)
    .replaceAll("|", "\\|")
    .replaceAll(/\s*\n\s*/g, " ")
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** A flight record folder as it appears inside the uploaded artifact. */
export function recordInArtifact(record: string): string {
  const at = record.indexOf(".danwo/runs/")

  return at === -1 ? record : record.slice(at + ".danwo/runs/".length)
}

function recordsSection(link: RecordsLink, records: readonly [string, string][]): string[] {
  if (records.length === 0) return []

  return [
    "",
    `**Flight records**: download the \`${link.artifact}\` artifact from [this run](${link.runUrl}#artifacts) and open \`report.html\`.`,
    "",
    ...records.map(([name, record]) => `- ${name}: \`${recordInArtifact(record)}\``),
  ]
}

function tally(reports: readonly TestReport[]): string {
  const count = (pick: (status: string) => boolean) =>
    reports.filter((report) => pick(report.status)).length
  const parts = [
    `${count((s) => s === "passed")} passed`,
    `${count((s) => FAILED.has(s))} failed`,
    `${count((s) => s === "flaky")} flaky`,
    `${count((s) => s === "skipped")} skipped`,
  ]

  return parts.join(" · ")
}

function testRow(report: TestReport): string {
  const failing = report.attempts.find((attempt) => attempt.error !== undefined)
  const error = failing?.error
  const where = error?.source ? ` (${error.source.file}:${error.source.line})` : ""
  const failure = error ? `${error.code}: ${error.message}${where}` : ""

  return `| ${STATUS_MARK[report.status] ?? ""} | ${cell(report.id)} | ${report.attempts.length} | ${cell(failure)} |`
}

/** The title line of a `danwo test` check. */
export function testTitle(run: TestRunReport): string {
  return run.brokenFiles.length > 0
    ? `${tally(run.reports)} · ${run.brokenFiles.length} files could not run`
    : tally(run.reports)
}

/** The integration lint's findings, once per rule and message, as a table. */
function lintSection(findings: readonly LintFinding[]): string[] {
  const distinct = distinctFindings(findings)

  if (distinct.length === 0) return []

  return [
    "",
    `**Integration lint**: ${distinct.length} finding${distinct.length === 1 ? "" : "s"}`,
    "",
    "| Level | Rule | Finding |",
    "|---|---|---|",
    ...distinct.map((f) => `| ${f.severity} | \`${f.rule}\` | ${cell(f.message)} |`),
  ]
}

/** The summary of a `danwo test` run. */
export function testSummary(run: TestRunReport, link: RecordsLink): string {
  const notable = run.reports.filter((r) => FAILED.has(r.status) || r.status === "flaky")
  const records = notable.flatMap((report): [string, string][] => {
    const record = report.attempts.findLast((attempt) => attempt.record)?.record

    return record ? [[report.id, record]] : []
  })
  const lines = [
    `### danwo test: ${testTitle(run)} in ${seconds(run.durationMs)}`,
    ...(notable.length === 0
      ? []
      : ["", "| | Test | Attempts | Failure |", "|---|---|---|---|", ...notable.map(testRow)]),
    ...run.brokenFiles.map(
      (broken) => `\n❌ \`${broken.file}\` could not run: ${cell(broken.error)}`,
    ),
    ...lintSection(run.reports.flatMap((r) => r.attempts.flatMap((a) => a.lint ?? []))),
    ...recordsSection(link, records),
  ]

  return capped(lines.join("\n"))
}

function matrixCounts(runs: readonly RunOutcome[]): string {
  const count = (status: RunOutcome["status"]) => runs.filter((r) => r.status === status).length
  const parts = [
    `${count("passed")} passed`,
    `${count("failed")} failed`,
    count("invalid") > 0 ? `${count("invalid")} invalid` : "",
    count("not-judged") > 0 ? `${count("not-judged")} not judged` : "",
    count("environment-error") > 0 ? `${count("environment-error")} environment errors` : "",
  ]

  return parts.filter(Boolean).join(" · ")
}

/** The title line of a `danwo matrix` check. */
export function matrixTitle(run: MatrixRunReport): string {
  return run.result.clean.status === "passed"
    ? `faults: ${matrixCounts(run.result.runs)}`
    : `clean run ${run.result.clean.status}: no faults planned`
}

function outcomeRow(outcome: RunOutcome): string {
  const details = [...outcome.notes, ...(outcome.error ? [outcome.error] : [])].join(" · ")

  return `| ${STATUS_MARK[outcome.status] ?? ""} | ${cell(outcome.fault?.label ?? "clean run")} | ${cell(details)} |`
}

/** The summary of a `danwo matrix` run: failures first, then every fault that held. */
export function matrixSummary(run: MatrixRunReport, link: RecordsLink): string {
  const outcomes = [run.result.clean, ...run.result.runs]
  const failing = outcomes.filter((outcome) => outcome.status !== "passed")
  const passing = outcomes.filter((outcome) => outcome.status === "passed")
  const records = failing.flatMap((o): [string, string][] =>
    o.record ? [[o.fault?.label ?? "clean run", o.record]] : [],
  )
  const lines = [
    `### danwo matrix: ${matrixTitle(run)} in ${seconds(run.durationMs)}`,
    "",
    `Test: \`${run.testId}\` (\`${fileOfTestId(run.testId)}\`)`,
    "",
    "| | Run | Details |",
    "|---|---|---|",
    ...[...failing, ...passing].map(outcomeRow),
    ...lintSection((run.lint ?? []).flatMap((trial) => trial.findings)),
    ...recordsSection(link, records),
  ]

  return capped(lines.join("\n"))
}

/** `summary` within GitHub's limit, cut with a note when longer. */
function capped(summary: string): string {
  const note = "\n\n…cut to fit; the job log has every line."

  return summary.length <= MAX_SUMMARY
    ? summary
    : `${summary.slice(0, MAX_SUMMARY - note.length)}${note}`
}
