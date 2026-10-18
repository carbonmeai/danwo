/**
 * A `danwo test` run's results as a file, so later commands can build on them: `--last-failed`
 * reruns what failed, and `danwo merge-reports` joins the shards of a CI run into one report.
 * Merging folds a rerun into what came before: a test that failed and then passed is flaky.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { resultOf } from "../tests/retry.ts"
import type { TestRunReport } from "./reporting.ts"
import type { TestReport } from "./tasks.ts"

/** What a results file holds: the run's report without the parts that only make sense live. */
export interface RunResults {
  readonly version: 1
  readonly reports: readonly TestReport[]
  readonly brokenFiles: TestRunReport["brokenFiles"]
  readonly durationMs: number
  /** Which shard of a split run this was, as `i/n`. */
  readonly shard?: string
  /** The run's directory name under `.danwo/runs`, when it recorded. */
  readonly run?: string
}

/** The ids of the tests that passed only on a later attempt in `results`. */
export function flakyIds(results: RunResults): Set<string> {
  return new Set(results.reports.filter((r) => r.status === "flaky").map((r) => r.id))
}

const RESULTS_DIR = join(".danwo", "results")

/** The latest run's results, which `--last-failed` reads. */
export function lastRunPath(root: string): string {
  return join(root, RESULTS_DIR, "last-run.json")
}

/** Where shard `i/n` keeps its results for `danwo merge-reports`. */
export function shardResultsPath(root: string, shard: string): string {
  return join(root, RESULTS_DIR, `shard-${shard.replace("/", "-of-")}.json`)
}

export async function writeResults(path: string, results: RunResults): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(results, null, 2)}\n`)
}

function isRunResults(value: unknown): value is RunResults {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "reports" in value &&
    Array.isArray(value.reports)
  )
}

/** The results at `path`, or undefined when there are none or they cannot be read. */
export async function readResults(path: string): Promise<RunResults | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))

    return isRunResults(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const FAILURE = new Set(["failed", "timed-out", "interrupted"])

/** The ids of the tests that failed in `results`. */
export function failedIds(results: RunResults): string[] {
  return results.reports.filter((report) => FAILURE.has(report.status)).map((report) => report.id)
}

/**
 * One test's report after a later run of it: the later run's attempts follow the earlier ones,
 * and the status comes from all of them, so failing then passing reads as flaky.
 */
function foldReport(earlier: TestReport, later: TestReport): TestReport {
  if (later.status === "skipped") return earlier

  const attempts = [...earlier.attempts, ...later.attempts]

  return {
    ...later,
    attempts,
    status: FAILURE.has(earlier.status) ? resultOf(attempts) : later.status,
  }
}

/**
 * Joins results: shards side by side, and a rerun over the run it repeats. A test in both keeps
 * every attempt, in order.
 */
export function mergeResults(runs: readonly RunResults[]): RunResults {
  const byId = new Map<string, TestReport>()

  for (const run of runs) {
    for (const report of run.reports) {
      const earlier = byId.get(report.id)

      byId.set(report.id, earlier === undefined ? report : foldReport(earlier, report))
    }
  }

  return {
    version: 1,
    reports: [...byId.values()],
    brokenFiles: stillBroken(runs),
    durationMs: runs.reduce((total, run) => total + run.durationMs, 0),
  }
}

/** Files that could not run, unless a later run ran them (they then report as tests). */
function stillBroken(runs: readonly RunResults[]): RunResults["brokenFiles"] {
  return runs.flatMap((run, index) => {
    const later = runs.slice(index + 1)
    const ranLater = new Set(
      later.flatMap((next) => [
        ...next.reports.map((report) => report.id.split(" › ")[0]),
        ...next.brokenFiles.map((broken) => broken.file),
      ]),
    )

    return run.brokenFiles.filter((broken) => !ranLater.has(broken.file))
  })
}
