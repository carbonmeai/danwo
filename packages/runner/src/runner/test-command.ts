/** `danwo test`: run the project's tests across worker processes and report them. */
import { basename, relative, resolve } from "node:path"

import { blockedLoadsLine, mergeBlockedLoads } from "@danwo/proxy"

import { type LintFinding, lintReport, withLint } from "../lint/index.ts"
import { DanwoError } from "../support/codes.ts"
import { catalogOf, testFilesOf, type CatalogEntry } from "./catalog.ts"
import { ciDefaults, inCi, parseShard, type Shard, shardFiles, shardLabel } from "./ci.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import { changedFiles } from "./git-changes.ts"
import { historyReporter } from "./history.ts"
import { chooseByChanges } from "./impact-command.ts"
import { updateImpactIndex } from "./impact.ts"
import { type LiveFeed, newRunId, openLiveFeed } from "./live.ts"
import { closeRecording, openRecording, recordingContext } from "./recording.ts"
import { closingLines, fileErrorLine, openingLine, runExitCode, testLine } from "./reporter.ts"
import { type RunCommandOptions, tellReporters, type TestRunReport } from "./reporting.ts"
import {
  failedIds,
  lastRunPath,
  mergeResults,
  readResults,
  type RunResults,
  shardResultsPath,
  writeResults,
} from "./results.ts"
import type { TestFileTask, TestReport } from "./tasks.ts"
import { runPool } from "./trial-pool.ts"

/** Which tests a run picks, beyond the config's test files. */
interface TestSelection {
  /** Paths or path fragments; a test file runs when its path contains one. */
  readonly patterns?: readonly string[]
  /** A regular expression over test ids. */
  readonly grep?: string
  /** Only the tests that failed in the latest run (`--last-failed`). */
  readonly lastFailed?: boolean
  /** Only the tests the files changed since `since` can affect (`--changed`). */
  readonly changed?: boolean
  /** The git ref `changed` compares with; default `HEAD` (uncommitted changes). */
  readonly since?: string
  /** This machine's part of a split run, as `i/n` (`--shard`). */
  readonly shard?: string
  /** Print the picked tests as JSON instead of running them (`--list`). */
  readonly list?: boolean
}

/** How the selected tests run. */
interface TestExecution {
  readonly workers?: number
  /** Extra attempts for a failing test; default the config's, else 1 in CI, else 0. */
  readonly retries?: number
  /** Starts no new test file once this many tests failed (`--max-failures`). */
  readonly maxFailures?: number
  /** Whether this is a CI run; default from the `CI` environment variable. */
  readonly ci?: boolean
  /**
   * Replay recorded agent steps only and call no model (`--replay-only`, or the config's
   * `cache.replayOnly`): a step with no recording that replays fails with `REPLAY_MISSING`.
   */
  readonly replayOnly?: boolean
}

export interface RunTestsOptions extends TestSelection, TestExecution, RunCommandOptions {}

const printLine = (line: string) => process.stdout.write(`${line}\n`)

/** The selected tests grouped into one task per file, in the order the files were found. */
function tasksOf(
  entries: readonly CatalogEntry[],
  task: Omit<TestFileTask, "file" | "testIds">,
): TestFileTask[] {
  const byFile = Map.groupBy(entries, (entry) => entry.file)

  return [...byFile].map(([file, tests]) => ({ ...task, file, testIds: tests.map((t) => t.id) }))
}

/** What the crew's run of the tasks came to. */
interface TaskRun {
  readonly brokenFiles: TestRunReport["brokenFiles"]
  /** Files never started because the run reached its failure limit. */
  readonly notRun: number
}

const FAILURE = new Set(["failed", "timed-out", "interrupted"])

/** Runs the tasks on the crew, starting no new file once `maxFailures` tests failed. */
async function runTasks(
  crew: Crew,
  tasks: readonly TestFileTask[],
  run: { cwd: string; write: (line: string) => void; failures: () => number; maxFailures?: number },
): Promise<TaskRun> {
  const broken: { file: string; error: string }[] = []

  let notRun = 0

  const work = async (task: TestFileTask) => {
    if (run.maxFailures !== undefined && run.failures() >= run.maxFailures) {
      notRun++

      return
    }

    await crew.testFile(task).catch((error: unknown) => {
      const file = relative(run.cwd, task.file)
      const message = String(error instanceof Error ? error.message : error)

      broken.push({ file, error: message })
      run.write(fileErrorLine(file, message))
    })
  }

  await runPool(tasks, work, () => false, { size: crew.size })

  return { brokenFiles: broken, notRun }
}

/** Runs the tests; resolves to the process exit code. */
export async function runTests(options: RunTestsOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? printLine
  const loaded = await loadConfig(cwd, options.config)
  const ci = options.ci ?? inCi()
  const picked = await pickTests(loaded, options, ci, write)

  if (options.list) return listTests(loaded, picked.entries, write)

  if (picked.entries.length === 0) {
    write(picked.empty)

    return picked.emptyCode
  }

  if (ci) write("CI: retries default to 1, the replay cache is read-only, .only is refused")

  if (replayOnly(loaded, options)) {
    if (loaded.config.cache === undefined)
      throw new DanwoError("CONFIG_INVALID", "--replay-only needs `cache.dir` in the config")
    write("replay-only: no model is called; a step with no recording that replays fails")
  }

  return executeRun({ loaded, options, ci, cwd, write, ...picked })
}

/** `--list`: the picked tests as one JSON array of their ids and files, and nothing run. */
function listTests(
  loaded: LoadedConfig,
  entries: readonly CatalogEntry[],
  write: (line: string) => void,
): number {
  write(
    JSON.stringify(
      entries.map((entry) => ({
        id: entry.id,
        file: relative(loaded.root, entry.file),
        invariant: entry.invariant,
      })),
    ),
  )

  return 0
}

interface Picked {
  readonly entries: readonly CatalogEntry[]
  /** The run `--last-failed` repeats, merged with this one at the end. */
  readonly previous?: RunResults
  readonly shard?: Shard
  /** Said when nothing is selected, with the exit code to end on. */
  readonly empty: string
  readonly emptyCode: number
}

/** The tests the options pick: files and shard, `.only` and grep, then last-failed or changed. */
async function pickTests(
  loaded: LoadedConfig,
  options: RunTestsOptions,
  ci: boolean,
  write: (line: string) => void,
): Promise<Picked> {
  const shard = options.shard === undefined ? undefined : parseShard(options.shard)
  const all = testFilesOf(loaded, options.patterns)
  const files = shard === undefined ? all : shardFiles(all, shard)
  const grep = options.grep === undefined ? undefined : new RegExp(options.grep)
  const entries = await catalogOf(loaded, files, grep, ciDefaults(ci).forbidOnly)
  const base = { ...(shard && { shard }), empty: "No tests found.", emptyCode: 1 }

  if (options.lastFailed) return pickLastFailed(loaded, entries, base)
  if (options.changed) return pickChanged(loaded, entries, options.since ?? "HEAD", base, write)

  return { ...base, entries }
}

async function pickLastFailed(
  loaded: LoadedConfig,
  entries: readonly CatalogEntry[],
  base: Omit<Picked, "entries">,
): Promise<Picked> {
  const previous = await readResults(lastRunPath(loaded.root))

  if (previous === undefined) {
    return { ...base, entries: [], empty: "No earlier run to repeat: run danwo test first." }
  }

  const ids = new Set(failedIds(previous))
  const brokenFiles = new Set(
    previous.brokenFiles.map((broken) => resolve(loaded.root, broken.file)),
  )
  const again = entries.filter((entry) => ids.has(entry.id) || brokenFiles.has(entry.file))

  return {
    ...base,
    entries: again,
    previous,
    empty: "No tests failed in the last run.",
    emptyCode: 0,
  }
}

async function pickChanged(
  loaded: LoadedConfig,
  entries: readonly CatalogEntry[],
  since: string,
  base: Omit<Picked, "entries">,
  write: (line: string) => void,
): Promise<Picked> {
  const changes = await changedFiles(loaded.root, since)

  write(`changed since ${since}: ${changes.length} file${changes.length === 1 ? "" : "s"}`)

  const chosen = await chooseByChanges(loaded, entries, changes, write)

  return { ...base, entries: chosen, empty: "No tests are affected by the change.", emptyCode: 0 }
}

interface RunInput extends Picked {
  readonly loaded: LoadedConfig
  readonly options: RunTestsOptions
  readonly ci: boolean
  readonly cwd: string
  readonly write: (line: string) => void
}

/** The crew a run's tests go to, each worker started for this project and its recording. */
function testCrew(
  input: RunInput,
  size: number,
  recording: ReturnType<typeof openRecording>,
  feed: LiveFeed,
  onTested: (report: TestReport) => void,
): Crew {
  const { loaded, options, cwd } = input

  return new Crew({
    size,
    start: {
      cwd,
      configPath: loaded.path,
      record: recording,
      updateScreenshots: options.updateScreenshots ?? false,
      ...(options.lint !== undefined && { lint: options.lint }),
    },
    onTested,
    onLive: (event) => feed.write(event),
  })
}

/** A finished test as the live feed shows it. */
function testEvent(report: TestReport) {
  return {
    type: "test",
    at: new Date().toISOString(),
    test: report.id,
    status: report.status,
    durationMs: report.attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
  } as const
}

/** Every attempt's integration lint findings. */
function findingsOf(reports: readonly TestReport[]): LintFinding[] {
  return reports.flatMap((report) => report.attempts.flatMap((attempt) => attempt.lint ?? []))
}

/** The run's one warning about hosts its pages were refused, every attempt's added up; none when nothing was. */
function blockedReport(reports: readonly TestReport[]): string[] {
  const line = blockedLoadsLine(
    mergeBlockedLoads(reports.flatMap((report) => report.attempts.map((a) => a.blocked ?? []))),
  )

  return line === undefined ? [] : [line]
}

/** Runs the picked tests with a live feed of them; resolves to the exit code. */
async function executeRun(input: RunInput): Promise<number> {
  const recording = openRecording(
    input.loaded,
    input.options.record,
    input.options.video,
    input.options.keepRuns,
  )
  const id = recording === undefined ? newRunId() : basename(recording.runDir)
  const count = input.entries.length
  const feed = await openLiveFeed(input.loaded.root, {
    id,
    kind: "test",
    title: `${count} ${count === 1 ? "test" : "tests"}`,
    planned: count,
  })
  const began = Date.now()
  let code = 1

  try {
    code = await runAndReport(input, { id, recording, feed, began })

    return code
  } finally {
    await feed.finish(code, Date.now() - began)
  }
}

/** What one run of the picked tests is: its id, recording and live feed. */
interface RunFrame {
  readonly id: string
  readonly recording: ReturnType<typeof openRecording>
  readonly feed: LiveFeed
  readonly began: number
}

/** Runs the picked tests on a crew and reports them; resolves to the exit code. */
async function runAndReport(input: RunInput, frame: RunFrame): Promise<number> {
  const { loaded, options, cwd, write } = input
  const { recording, feed, began } = frame
  const { tasks, size } = planRun(loaded, options, input.ci, input.entries)
  const reporters = [
    historyReporter(),
    ...(loaded.config.reporters ?? []),
    ...(options.reporters ?? []),
  ]
  const context = {
    kind: "test",
    root: loaded.root,
    cwd,
    id: frame.id,
    ...recordingContext(recording),
  } as const
  const reports: TestReport[] = []
  const crew = testCrew(input, size, recording, feed, (report) => {
    reports.push(report)
    write(testLine(report))
    feed.write(testEvent(report))
  })

  write(openingLine(input.entries.length, size))
  await tellReporters(reporters, (r) => r.started?.(context), write)

  let ran: TaskRun = { brokenFiles: [], notRun: 0 }

  try {
    ran = await runTasks(crew, tasks, {
      cwd,
      write,
      failures: () => reports.filter((report) => FAILURE.has(report.status)).length,
      ...(options.maxFailures !== undefined && { maxFailures: options.maxFailures }),
    })
  } finally {
    await crew.disband()
  }

  const results = await saveResults(input, {
    version: 1,
    reports,
    brokenFiles: ran.brokenFiles,
    durationMs: Date.now() - began,
    ...(input.shard && { shard: shardLabel(input.shard) }),
    ...(recording && { run: basename(recording.runDir) }),
  })

  const findings = findingsOf(results.reports)

  for (const line of closingLines(results.reports, { replayOnly: replayOnly(loaded, options) }))
    write(line)
  for (const line of [...lintReport(findings), ...blockedReport(results.reports)]) write(line)
  if (ran.notRun > 0)
    write(`stopped after ${options.maxFailures} failed: ${ran.notRun} test files not run`)

  const reportPath = await closeRecording(recording, cwd, write)
  const run = { ...context, ...results, reportPath }

  await tellReporters(reporters, (r) => r.testsFinished?.(run), write)

  return withLint(runExitCode(results.reports, results.brokenFiles), findings, loaded.config.lint)
}

/**
 * Keeps the run's results for later commands, and updates the impact index from its passing
 * tests. A `--last-failed` run is merged into the run it repeats first. Resolves to what to report.
 */
async function saveResults(input: RunInput, results: RunResults): Promise<RunResults> {
  const { root } = input.loaded
  const merged = input.previous === undefined ? results : mergeResults([input.previous, results])
  const fileOf = new Map(input.entries.map((entry) => [entry.id, entry.file]))

  await writeResults(lastRunPath(root), merged)
  if (results.shard !== undefined)
    await writeResults(shardResultsPath(root, results.shard), results)
  await updateImpactIndex(root, results.reports, (id) => fileOf.get(id))

  return merged
}

/** Whether the run replays only: `--replay-only`, else the config's `cache.replayOnly`. */
function replayOnly(loaded: LoadedConfig, options: RunTestsOptions): boolean {
  return options.replayOnly ?? loaded.config.cache?.replayOnly ?? false
}

/** One task per file, and how many workers they get: no more than there are files. */
function planRun(
  loaded: LoadedConfig,
  options: RunTestsOptions,
  ci: boolean,
  entries: readonly CatalogEntry[],
): { tasks: TestFileTask[]; size: number } {
  const { cache } = loaded.config
  const defaults = ciDefaults(ci)
  const tasks = tasksOf(entries, {
    retries: options.retries ?? loaded.config.retries ?? defaults.retries,
    cacheDir: cache && resolve(loaded.root, cache.dir),
    cacheReadOnly: defaults.cacheReadOnly,
    ...(replayOnly(loaded, options) && { replayOnly: true }),
  })

  return { tasks, size: Math.min(options.workers ?? loaded.config.workers ?? 1, tasks.length) }
}
