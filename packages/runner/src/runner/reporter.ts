/**
 * What `danwo test` prints: a line per test as it finishes, then each failure with its error and
 * flight record, then a summary line.
 */
import pc from "picocolors"

import { addUsage, cacheLine, dollars, modelLine, type Usage } from "../record/usage.ts"
import { type ErrorClass, exitCodeOf } from "../support/codes.ts"
import type { ResultStatus } from "../tests/retry.ts"
import { testName, type TestReport } from "./tasks.ts"
import { type FailureVerdict, VERDICT_LABELS, verdictSummary } from "./verdict-words.ts"

const SYMBOL: Readonly<Record<ResultStatus, string>> = {
  passed: pc.green("✓"),
  flaky: pc.yellow("~"),
  failed: pc.red("✗"),
  "timed-out": pc.red("⏱"),
  interrupted: pc.red("!"),
  skipped: pc.dim("-"),
}

const isFailure = (status: ResultStatus) =>
  status === "failed" || status === "timed-out" || status === "interrupted"

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

/** One test's line: symbol, id, attempts when it took more than one, time and worker. */
export function testLine(report: TestReport): string {
  const ms = report.attempts.reduce((total, attempt) => total + attempt.durationMs, 0)
  const attempts = report.attempts.length > 1 ? pc.dim(` (${report.attempts.length} attempts)`) : ""

  return `  ${SYMBOL[report.status]} ${testName(report)}${attempts} ${pc.dim(`${ms} ms, worker ${report.workerIndex}`)}`
}

/** A verdict as a failure's header shows it: "App bug (likely)". */
function verdictTag(verdict: FailureVerdict): string {
  const label = VERDICT_LABELS[verdict.verdict]

  return verdict.confidence === "likely" ? `${label} (likely)` : label
}

/** A failed test in full: its id and verdict, its last attempt's error, and its flight record. */
function failureLines(report: TestReport): string[] {
  const last = report.attempts.at(-1)
  const tag = last?.verdict ? pc.dim(`  [${verdictTag(last.verdict)}]`) : ""

  return [
    "",
    pc.red(pc.bold(`✗ ${testName(report)}`)) + tag,
    ...(last?.error ? [`  ${last.error.code}: ${last.error.message}`] : []),
    ...(last?.verdict ? [pc.dim(`  why: ${last.verdict.reason}`)] : []),
    ...(last?.record ? [pc.dim(`  record: ${last.record}`)] : []),
  ]
}

/** The verdicts of the run's failed tests, by their last attempt. */
function failedVerdicts(reports: readonly TestReport[]): (FailureVerdict | undefined)[] {
  return reports
    .filter((report) => isFailure(report.status))
    .map((report) => report.attempts.at(-1)?.verdict)
}

function summaryLine(reports: readonly TestReport[]): string {
  const tally = (status: ResultStatus) =>
    reports.filter((report) => report.status === status).length
  const failed = reports.filter((report) => isFailure(report.status)).length
  const split = verdictSummary(failedVerdicts(reports))

  return [
    `${tally("passed")} passed`,
    tally("flaky") > 0 ? `${tally("flaky")} flaky` : "",
    failed > 0 ? pc.red(`${failed} failed`) + (split === "" ? "" : ` (${split})`) : "",
    tally("skipped") > 0 ? `${tally("skipped")} skipped` : "",
  ]
    .filter((part) => part !== "")
    .join(", ")
}

/**
 * The run's first line: how many tests, in which engines when it names them, on how many workers.
 * Each engine runs every test, so `browsers` multiplies the runs.
 */
export function openingLine(
  tests: number,
  workers: number,
  browsers: readonly string[] = [],
): string {
  const where =
    browsers.length === 0
      ? count(tests, "test")
      : browsers.length === 1
        ? `${count(tests, "test")} in ${browsers.join("")}`
        : `${count(tests * browsers.length, "test")} (${tests} in each of ${browsers.join(", ")})`

  return pc.dim(`Running ${where} with ${count(workers, "worker")}`)
}

/** Lines of a file's error kept under its first, such as the output of an app that would not start. */
const FILE_ERROR_DETAIL_LINES = 40

/**
 * A file that could not run at all (it failed to load, or its worker died): the error's first line,
 * then the rest of it dimmed and indented (the last lines only), since that is often the only
 * place an app's own startup error shows.
 */
export function fileErrorLine(file: string, error: string): string {
  const [first = error, ...rest] = error.split("\n")
  const detail = rest.filter((line) => line.trim() !== "").slice(-FILE_ERROR_DETAIL_LINES)

  return [
    `  ${pc.red("✗")} ${file}: ${first}`,
    ...detail.map((line) => pc.dim(`      ${line}`)),
  ].join("\n")
}

/** A flaky test: it passed only after failing, so its failed attempts are worth a look. */
function flakyLines(report: TestReport): string[] {
  const failed = report.attempts.filter((attempt) => attempt.status !== "passed")

  return [
    "",
    pc.yellow(`~ flaky: ${testName(report)} (passed on attempt ${report.attempts.length})`),
    ...failed.flatMap((attempt) => [
      ...(attempt.error ? [`  ${attempt.error.code}: ${attempt.error.message}`] : []),
      ...(attempt.record ? [pc.dim(`  record: ${attempt.record}`)] : []),
    ]),
  ]
}

/**
 * The failures in full, the flaky tests, and the summary, after every test reported. A
 * replay-only run always says how many model calls it made, which is none.
 */
export function closingLines(
  reports: readonly TestReport[],
  run: { readonly replayOnly?: boolean } = {},
): string[] {
  return [
    ...reports.filter((report) => isFailure(report.status)).flatMap(failureLines),
    ...reports.filter((report) => report.status === "flaky").flatMap(flakyLines),
    "",
    summaryLine(reports),
    ...usageLines(reports, run.replayOnly === true),
  ]
}

/** How many of the costliest steps the summary lists. */
const COSTLIEST = 5

/** Every attempt's usage, each step named by its test. */
function attemptUsages(reports: readonly TestReport[]): Usage[] {
  return reports.flatMap((report) =>
    report.attempts.flatMap((attempt) =>
      attempt.usage === undefined
        ? []
        : [
            {
              ...attempt.usage,
              steps: attempt.usage.steps.map((cost) => ({
                ...cost,
                step: { ...cost.step, label: `${testName(report)} › ${cost.step.label}` },
              })),
            },
          ],
    ),
  )
}

/** The run's `cache:` and `model:` lines, then its costliest model steps, as a small table. */
function usageLines(reports: readonly TestReport[], replayOnly: boolean): string[] {
  const usage = addUsage(attemptUsages(reports))
  const cache = cacheLine(usage.cache, usage.recordings, usage.models)
  const model = modelLine(usage) ?? (replayOnly ? "model: 0 calls (replay-only)" : undefined)
  const costliest = usage.steps
    .toSorted((a, b) => b.spent.usd - a.spent.usd || b.spent.calls - a.spent.calls)
    .slice(0, COSTLIEST)

  return [
    ...(cache === undefined ? [] : [pc.dim(cache)]),
    ...(model === undefined ? [] : [pc.dim(model)]),
    ...costliest.map(({ step, spent }) =>
      pc.dim(
        `  ${String(spent.calls).padStart(3)} calls  ${dollars(spent.usd).padStart(8)}  ${step.label}`,
      ),
    ),
  ]
}

/** A file that could not run because of how it is written, rather than because a worker failed. */
const CONFIG_BREAKAGE =
  /SyntaxError|Cannot find (module|package)|must default-export|is not defined/

/** The class of each failure in the run: tests by their last attempt's error, then broken files. */
function failureClasses(
  reports: readonly TestReport[],
  brokenFiles: readonly { readonly error: string }[],
): ErrorClass[] {
  const tests = reports
    .filter((report) => isFailure(report.status))
    .map((report): ErrorClass =>
      report.status === "interrupted"
        ? "interrupted"
        : (report.attempts.at(-1)?.error?.class ?? "test"),
    )
  const files = brokenFiles.map((broken): ErrorClass =>
    CONFIG_BREAKAGE.test(broken.error) ? "config" : "infra",
  )

  return [...tests, ...files]
}

/** The run's exit code: 0 when nothing failed, else the deciding failure's (see codes.ts). */
export function runExitCode(
  reports: readonly TestReport[],
  brokenFiles: readonly { readonly error: string }[],
): number {
  return exitCodeOf(failureClasses(reports, brokenFiles))
}
