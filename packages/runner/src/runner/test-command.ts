/** `danwo test`: run the project's tests across worker processes and report them. */
import { basename, resolve } from "node:path"

import { blockedLoadsLine, mergeBlockedLoads } from "@danwo/proxy"

import { type BrowserName, runBrowsers } from "../browser/engines.ts"
import { type LintFinding, lintReport, withLint } from "../lint/index.ts"
import { missingLine } from "../record/missing.ts"
import { DanwoError } from "../support/codes.ts"
import { relativeSlashed } from "../support/paths.ts"
import { catalogOf, testFilesOf, type CatalogEntry } from "./catalog.ts"
import { ciDefaults, inCi, parseShard, type Shard, shardFiles, shardLabel } from "./ci.ts"
import { type LoadedConfig, loadRunConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import { changedFiles } from "./git-changes.ts"
import { historyReporter } from "./history.ts"
import { chooseByChanges } from "./impact-command.ts"
import { updateImpactIndex } from "./impact.ts"
import { type LiveFeed, newRunId, openLiveFeed } from "./live.ts"
import { closeRecording, openRecording, recordingContext } from "./recording.ts"
import { closingLines, fileErrorLine, openingLine, runExitCode, testLine } from "./reporter.ts"
import { type RunCommandOptions, suiteOf, tellReporters, type TestRunReport } from "./reporting.ts"
import {
  failedIds,
  lastRunPath,
  mergeResults,
  readResults,
  type RunResults,
  shardResultsPath,
  writeResults,
} from "./results.ts"
import { type TestFileTask, testName, type TestReport } from "./tasks.ts"
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
  /** Hand workers single tests of the files whose tests share nothing (`--split-files`). */
  readonly splitFiles?: boolean
  /** Extra attempts for a failing test; default the config's, else 1 in CI, else 0. */
  readonly retries?: number
  /** Starts no new test file once this many tests failed (`--max-failures`). */
  readonly maxFailures?: number
  /**
   * Starts no new test file once the run has taken this long, in milliseconds (`--max-duration`).
   * Files already running finish; the run fails when any file was left out.
   */
  readonly maxDurationMs?: number
  /** Whether this is a CI run; default from the `CI` environment variable. */
  readonly ci?: boolean
  /**
   * Replay recorded agent steps only and call no model (`--replay-only`, or the config's
   * `cache.replayOnly`): a step with no recording that replays fails with `REPLAY_MISSING`.
   */
  readonly replayOnly?: boolean
  /**
   * The engines to run in, as `firefox` or `chromium,webkit` (`--browser`); default the config's
   * `browser.name`, else Chromium. Several run the suite once per engine.
   */
  readonly browser?: string
}

export interface RunTestsOptions extends TestSelection, TestExecution, RunCommandOptions {}

const printLine = (line: string) => process.stdout.write(`${line}\n`)

const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }

/** A duration such as `20m`, `90s`, `1h` or `500ms` in milliseconds; a bare number is seconds. */
export function parseDuration(text: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim())

  if (match?.[1] === undefined) return undefined

  const ms = Number(match[1]) * (UNIT_MS[match[2] ?? "s"] ?? 1_000)

  return ms > 0 ? ms : undefined
}

/**
 * The selected tests grouped into one task per file, in the order the files were found. With
 * `split`, a file whose tests are all standalone becomes one task per test, so several workers
 * share it.
 */
export function tasksOf(
  entries: readonly CatalogEntry[],
  task: Omit<TestFileTask, "file" | "testIds">,
  split = false,
): TestFileTask[] {
  const byFile = Map.groupBy(entries, (entry) => entry.file)

  return [...byFile].flatMap(([file, tests]) =>
    split && tests.every((test) => test.standalone === true)
      ? tests.map((test) => ({ ...task, file, testIds: [test.id] }))
      : [{ ...task, file, testIds: tests.map((test) => test.id) }],
  )
}

/** What the crew's run of the tasks came to. */
interface TaskRun {
  readonly brokenFiles: TestRunReport["brokenFiles"]
  /** Tasks never started because the run reached its failure or time limit. */
  readonly notRun: number
  /** The tests of those tasks. */
  readonly testsNotRun: number
}

const FAILURE = new Set(["failed", "timed-out", "interrupted"])

/** Runs the tasks on the crew, starting no new file once `stopped()` says the run is over. */
async function runTasks(
  crew: Crew,
  tasks: readonly TestFileTask[],
  run: { cwd: string; write: (line: string) => void; stopped: () => boolean },
): Promise<TaskRun> {
  const broken: { file: string; error: string }[] = []

  let notRun = 0
  let testsNotRun = 0

  const work = async (task: TestFileTask) => {
    if (run.stopped()) {
      notRun++
      testsNotRun += task.testIds.length

      return
    }

    await crew.testFile(task).catch((error: unknown) => {
      const file = relativeSlashed(run.cwd, task.file)
      const message = String(error instanceof Error ? error.message : error)

      broken.push({ file, error: message })
      run.write(fileErrorLine(file, message))
    })
  }

  await runPool(tasks, work, () => false, { size: crew.size })

  return { brokenFiles: broken, notRun, testsNotRun }
}

/** Runs the tests; resolves to the process exit code. */
export async function runTests(options: RunTestsOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? printLine
  const loaded = await loadRunConfig(cwd, options.config)

  const ci = options.ci ?? inCi()
  const browsers = runBrowsers(loaded.config.browser?.name, options.browser)
  const picked = await pickTests(loaded, options, ci, write)

  if (options.list) return listTests(loaded, picked.entries, labels(browsers), write)

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

  return executeRun({ loaded, options, ci, cwd, write, browsers, ...picked })
}

/**
 * `--list`: the picked tests as one JSON array of their ids and files, and nothing run. A run that
 * names its engines lists each test once per engine, with the engine, in the order they run.
 */
function listTests(
  loaded: LoadedConfig,
  entries: readonly CatalogEntry[],
  browsers: readonly BrowserName[],
  write: (line: string) => void,
): number {
  const listed = (entry: CatalogEntry) => ({
    id: entry.id,
    file: relativeSlashed(loaded.root, entry.file),
    invariant: entry.invariant,
  })

  write(
    JSON.stringify(
      browsers.length === 0
        ? entries.map(listed)
        : browsers.flatMap((browser) => entries.map((entry) => ({ ...listed(entry), browser }))),
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
  /** The engines the run goes through, each test once in each. */
  readonly browsers: readonly BrowserName[]
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
    test: testName(report),
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

/**
 * The run's one warning about the screenshots and videos its tests asked for and lost; none when
 * nothing was. It warns rather than fails: what the app did is judged either way, and a full disk
 * or a secret on the page should not turn a passing run red.
 */
function missingReport(reports: readonly TestReport[]): string[] {
  const line = missingLine(
    reports.flatMap((report) =>
      report.attempts.flatMap((attempt) =>
        (attempt.missing ?? []).map((missing) => ({ test: report.id, missing })),
      ),
    ),
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
  const count = input.entries.length * input.browsers.length
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
  const { tasks, size } = planRun(loaded, options, input)
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
    ...suiteOf(options.name, loaded.config),
  } as const
  const reports: TestReport[] = []
  const crew = testCrew(input, size, recording, feed, (report) => {
    reports.push(report)
    write(testLine(report))
    feed.write(testEvent(report))
  })

  write(openingLine(input.entries.length, size, labels(input.browsers)))
  await tellReporters(reporters, (r) => r.started?.(context), write)

  let ran: TaskRun = { brokenFiles: [], notRun: 0, testsNotRun: 0 }

  const limits = runLimits(options, began, reports)

  try {
    ran = await runTasks(crew, tasks, { cwd, write, stopped: limits.stopped })
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
  for (const line of [
    ...lintReport(findings),
    ...blockedReport(results.reports),
    ...missingReport(results.reports),
    ...stopLines(limits.outOfFailures(), ran, {
      ...options,
      splitFiles: splitsFiles(loaded, options),
    }),
  ])
    write(line)

  const reportPath = await closeRecording(recording, cwd, write)
  const run = { ...context, ...results, reportPath }

  await tellReporters(reporters, (r) => r.testsFinished?.(run), write)

  const code = withLint(
    runExitCode(results.reports, results.brokenFiles),
    findings,
    loaded.config.lint,
  )

  /* Files a time budget left out were never judged: the run did not pass. */
  return ran.notRun > 0 ? Math.max(code, 1) : code
}

/**
 * When a run starts no more files: once `maxFailures` tests failed, or once it has taken
 * `maxDurationMs`.
 */
function runLimits(
  options: Pick<TestExecution, "maxFailures" | "maxDurationMs">,
  began: number,
  reports: readonly TestReport[],
): { readonly outOfFailures: () => boolean; readonly stopped: () => boolean } {
  const { maxFailures, maxDurationMs } = options
  const failed = () => reports.filter((report) => FAILURE.has(report.status)).length
  const outOfFailures = () => maxFailures !== undefined && failed() >= maxFailures
  const outOfTime = () => maxDurationMs !== undefined && Date.now() - began >= maxDurationMs

  return { outOfFailures, stopped: () => outOfFailures() || outOfTime() }
}

/** Why the run started no more files, and how many it left out; nothing when it ran them all. */
function stopLines(
  outOfFailures: boolean,
  ran: Pick<TaskRun, "notRun" | "testsNotRun">,
  options: Pick<TestExecution, "maxFailures" | "maxDurationMs" | "splitFiles">,
): string[] {
  if (ran.notRun === 0) return []

  /* Split files hand out single tests, so what was left out is counted in tests. */
  const left = options.splitFiles === true ? `${ran.testsNotRun} tests` : `${ran.notRun} test files`

  if (outOfFailures) return [`stopped after ${options.maxFailures} failed: ${left} not run`]

  const seconds = Math.round((options.maxDurationMs ?? 0) / 1000)

  return [`stopped at --max-duration (${seconds} s): ${left} not run`]
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

/** Whether workers get single tests of the files that allow it: the flag, else the config. */
function splitsFiles(loaded: LoadedConfig, options: Pick<TestExecution, "splitFiles">): boolean {
  return options.splitFiles ?? loaded.config.splitFiles ?? false
}

/**
 * The engines a run labels its tests with: none for Chromium alone, the run every config had
 * before engines could be named, so its output and records stay as they were.
 */
function labels(browsers: readonly BrowserName[]): readonly BrowserName[] {
  return browsers.length === 1 && browsers[0] === "chromium" ? [] : browsers
}

/**
 * One task per file (or per test, for the files `splitFiles` splits) in each engine, every
 * engine's tasks after the one before's, and how many workers they get: no more than there are
 * tasks.
 */
function planRun(
  loaded: LoadedConfig,
  options: RunTestsOptions,
  input: Pick<RunInput, "ci" | "entries" | "browsers">,
): { tasks: TestFileTask[]; size: number } {
  const { cache } = loaded.config
  const { ci, entries } = input
  const defaults = ciDefaults(ci)
  const task = {
    retries: options.retries ?? loaded.config.retries ?? defaults.retries,
    cacheDir: cache && resolve(loaded.root, cache.dir),
    cacheReadOnly: defaults.cacheReadOnly,
    ...(replayOnly(loaded, options) && { replayOnly: true }),
  }
  const named = labels(input.browsers)
  const tasks =
    named.length === 0
      ? tasksOf(entries, task, splitsFiles(loaded, options))
      : named.flatMap((browser) =>
          tasksOf(entries, { ...task, browser }, splitsFiles(loaded, options)),
        )

  return { tasks, size: Math.min(options.workers ?? loaded.config.workers ?? 1, tasks.length) }
}
