/**
 * What `danwo test` prints: a line per test as it finishes, then each failure with its error and
 * flight record, then a summary line.
 */
import pc from "picocolors"

import { addUsage, cacheLine, dollars, modelLine, type Usage } from "../record/usage.ts"
import { type ErrorClass, exitCodeOf } from "../support/codes.ts"
import type { ResultStatus } from "../tests/retry.ts"
import type { TestReport } from "./tasks.ts"

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

  return `  ${SYMBOL[report.status]} ${report.id}${attempts} ${pc.dim(`${ms} ms, worker ${report.workerIndex}`)}`
}

/** A failed test in full: its id, its last attempt's error, and where its flight record is. */
function failureLines(report: TestReport): string[] {
  const last = report.attempts.at(-1)

  return [
    "",
    pc.red(pc.bold(`✗ ${report.id}`)),
    ...(last?.error ? [`  ${last.error.code}: ${last.error.message}`] : []),
    ...(last?.record ? [pc.dim(`  record: ${last.record}`)] : []),
  ]
}

function summaryLine(reports: readonly TestReport[]): string {
  const tally = (status: ResultStatus) =>
    reports.filter((report) => report.status === status).length
  const failed = reports.filter((report) => isFailure(report.status)).length

  return [
    `${tally("passed")} passed`,
    tally("flaky") > 0 ? `${tally("flaky")} flaky` : "",
    failed > 0 ? pc.red(`${failed} failed`) : "",
    tally("skipped") > 0 ? `${tally("skipped")} skipped` : "",
  ]
    .filter((part) => part !== "")
    .join(", ")
}

export function openingLine(tests: number, workers: number): string {
  return pc.dim(`Running ${count(tests, "test")} with ${count(workers, "worker")}`)
}

/** A file that could not run at all (it failed to load, or its worker died). */
export function fileErrorLine(file: string, error: string): string {
  return `  ${pc.red("✗")} ${file}: ${error.split("\n")[0] ?? error}`
}

/** The failures in full and the summary, after every test reported. */
export function closingLines(reports: readonly TestReport[]): string[] {
  return [
    ...reports.filter((report) => isFailure(report.status)).flatMap(failureLines),
    "",
    summaryLine(reports),
    ...usageLines(reports),
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
                step: { ...cost.step, label: `${report.id} › ${cost.step.label}` },
              })),
            },
          ],
    ),
  )
}

/** The run's `cache:` and `model:` lines, then its costliest model steps, as a small table. */
function usageLines(reports: readonly TestReport[]): string[] {
  const usage = addUsage(attemptUsages(reports))
  const cache = cacheLine(usage.cache)
  const model = modelLine(usage)
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
