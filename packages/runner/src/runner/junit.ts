/**
 * A JUnit XML reporter for CI systems other than GitHub (GitLab, Jenkins, CircleCI, Buildkite read
 * it). `danwo test` writes a suite per test file and a case per test; `danwo matrix` writes one
 * suite for the test with a case per run, clean and faulted. Flaky tests pass, with their earlier
 * failures kept as `<system-out>`.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path"

import type { MatrixRunReport, Reporter, TestRunReport } from "./reporting.ts"
import type { TestReport } from "./tasks.ts"

export interface JunitOptions {
  /** Where the XML goes, relative to the project root; default `.danwo/junit.xml`. */
  readonly outputFile?: string
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const seconds = (ms: number) => (ms / 1000).toFixed(3)

/** A flaky test passes, with the failures before its passing attempt as output. */
function flakyBody(report: TestReport): string {
  const errors = report.attempts.flatMap((attempt) => (attempt.error ? [attempt.error] : []))
  const text = `flaky: passed after ${errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`

  return `<system-out>${escapeXml(text)}</system-out>`
}

/** A failed test, with its last attempt's error. */
function failureBody(report: TestReport): string {
  const last = report.attempts.at(-1)?.error
  const message = last ? `${last.code}: ${last.message}` : report.status

  return `<failure message="${escapeXml(message)}" type="${escapeXml(last?.code ?? report.status)}">${escapeXml(last?.stack ?? "")}</failure>`
}

/** What goes inside a test's case element: nothing when it passed. */
function caseBody(report: TestReport): string {
  if (report.status === "passed") return ""
  if (report.status === "skipped") return "<skipped/>"

  return report.status === "flaky" ? flakyBody(report) : failureBody(report)
}

/** The element for one test: passed, skipped, failed with its last error, or flaky. */
function testCase(report: TestReport, suite: string): string {
  const name = escapeXml(report.id.split(" › ").slice(1).join(" › ") || report.id)
  const time = seconds(report.attempts.reduce((total, attempt) => total + attempt.durationMs, 0))

  return `<testcase classname="${escapeXml(suite)}" name="${name}" time="${time}">${caseBody(report)}</testcase>`
}

const FAILING = new Set(["failed", "timed-out", "interrupted"])

const failing = (reports: readonly TestReport[]) =>
  reports.filter((report) => FAILING.has(report.status)).length

/** The XML for a `danwo test` run: a suite per file. */
export function testRunXml(run: TestRunReport): string {
  const byFile = Map.groupBy(run.reports, (report) => report.id.split(" › ")[0] ?? "")
  const suites = [...byFile].map(
    ([file, reports]) =>
      `<testsuite name="${escapeXml(file)}" tests="${reports.length}" failures="${failing(reports)}" skipped="${reports.filter((r) => r.status === "skipped").length}">${reports.map((r) => testCase(r, file)).join("")}</testsuite>`,
  )
  const broken = run.brokenFiles.map(
    (file) =>
      `<testsuite name="${escapeXml(file.file)}" tests="1" errors="1"><testcase classname="${escapeXml(file.file)}" name="load"><error message="${escapeXml(file.error)}"/></testcase></testsuite>`,
  )

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="danwo" time="${seconds(run.durationMs)}">${[...suites, ...broken].join("")}</testsuites>\n`
}

/** The XML for a `danwo matrix` run: one suite, a case per run. */
export function matrixRunXml(run: MatrixRunReport): string {
  const outcomes = [run.result.clean, ...run.result.runs]
  const cases = outcomes.map((outcome) => {
    const name = escapeXml(outcome.fault?.label ?? "clean run")
    const open = `<testcase classname="${escapeXml(run.testId)}" name="${name}">`
    const detail = escapeXml([outcome.error ?? "", ...outcome.notes].join("\n").trim())

    if (outcome.status === "passed") return `${open}</testcase>`

    if (outcome.status === "failed") {
      return `${open}<failure message="${escapeXml(outcome.error ?? "failed")}">${detail}</failure></testcase>`
    }

    return `${open}<skipped message="${escapeXml(`${outcome.status}: ${outcome.error ?? ""}`)}"/></testcase>`
  })
  const failures = outcomes.filter((outcome) => outcome.status === "failed").length

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="danwo matrix" time="${seconds(run.durationMs)}"><testsuite name="${escapeXml(run.testId)}" tests="${cases.length}" failures="${failures}">${cases.join("")}</testsuite></testsuites>\n`
}

/** Writes a JUnit XML file when a run finishes; `--reporter junit` on the command line. */
export function junit(options: JunitOptions = {}): Reporter {
  const write = async (root: string, cwd: string, xml: string) => {
    const file = options.outputFile ?? join(".danwo", "junit.xml")
    const path = isAbsolute(file) ? file : join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, xml)
    process.stdout.write(`junit: ${relative(cwd, path)}\n`)
  }

  return {
    name: "junit",
    testsFinished: (run) => write(run.root, run.cwd, testRunXml(run)),
    matrixFinished: (run) => write(run.root, run.cwd, matrixRunXml(run)),
  }
}
