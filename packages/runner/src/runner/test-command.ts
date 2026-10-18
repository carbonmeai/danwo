/** `danwo test`: run the project's tests across worker processes and report them. */
import { basename, relative, resolve } from "node:path"

import { catalogOf, testFilesOf, type CatalogEntry } from "./catalog.ts"
import { ciDefaults, inCi, parseShard, type Shard, shardFiles, shardLabel } from "./ci.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import { changedFiles } from "./git-changes.ts"
import { chooseByChanges } from "./impact-command.ts"
import { updateImpactIndex } from "./impact.ts"
import { closeRecording, openRecording } from "./recording.ts"
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

  if (picked.entries.length === 0) {
    write(picked.empty)

    return picked.emptyCode
  }

  if (ci) write("CI: retries default to 1, the replay cache is read-only, .only is refused")

  return executeRun({ loaded, options, ci, cwd, write, ...picked })
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

/** Runs the picked tests on a crew and reports them; resolves to the exit code. */
async function executeRun(input: RunInput): Promise<number> {
  const { loaded, options, cwd, write } = input
  const { tasks, size } = planRun(loaded, options, input.ci, input.entries)
  const recording = openRecording(loaded, options.record)
  const reporters = [...(loaded.config.reporters ?? []), ...(options.reporters ?? [])]
  const context = { kind: "test", root: loaded.root, cwd } as const
  const began = Date.now()
  const reports: TestReport[] = []
  const crew = new Crew({
    size,
    start: {
      cwd,
      configPath: loaded.path,
      record: recording,
      updateScreenshots: options.updateScreenshots ?? false,
    },
    onTested: (report) => {
      reports.push(report)
      write(testLine(report))
    },
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

  for (const line of closingLines(results.reports)) write(line)
  if (ran.notRun > 0)
    write(`stopped after ${options.maxFailures} failed: ${ran.notRun} test files not run`)

  const reportPath = await closeRecording(recording, cwd, write)
  const run = { ...context, ...results, reportPath }

  await tellReporters(reporters, (r) => r.testsFinished?.(run), write)

  return runExitCode(results.reports, results.brokenFiles)
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
  })

  return { tasks, size: Math.min(options.workers ?? loaded.config.workers ?? 1, tasks.length) }
}
