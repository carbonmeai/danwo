/** `danwo test`: run the project's tests across worker processes and report them. */
import { relative, resolve } from "node:path"

import { catalogOf, testFilesOf, type CatalogEntry } from "./catalog.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import type { RecordMode } from "./record.ts"
import { closeRecording, openRecording } from "./recording.ts"
import { anyFailed, closingLines, fileErrorLine, openingLine, testLine } from "./reporter.ts"
import { type Reporter, tellReporters, type TestRunReport } from "./reporting.ts"
import type { TestFileTask, TestReport } from "./tasks.ts"

export interface RunTestsOptions {
  readonly cwd?: string
  readonly config?: string
  /** Paths or path fragments; a test file runs when its path contains one. */
  readonly patterns?: readonly string[]
  readonly workers?: number
  readonly retries?: number
  /** A regular expression over test ids. */
  readonly grep?: string
  /** Flight recorder mode; overrides the config's `record`. */
  readonly record?: RecordMode
  /** Rewrite every `toHaveScreenshot` baseline (`--update-snapshots`). */
  readonly updateScreenshots?: boolean
  /** Reporters besides the config's, e.g. from `--reporter`. */
  readonly reporters?: readonly Reporter[]
  readonly write?: (line: string) => void
}

const printLine = (line: string) => process.stdout.write(`${line}\n`)

/** The selected tests grouped into one task per file, in the order the files were found. */
function tasksOf(
  entries: readonly CatalogEntry[],
  task: Omit<TestFileTask, "file" | "testIds">,
): TestFileTask[] {
  const byFile = Map.groupBy(entries, (entry) => entry.file)

  return [...byFile].map(([file, tests]) => ({ ...task, file, testIds: tests.map((t) => t.id) }))
}

/** Runs every task on the crew; resolves to the files that could not run at all. */
async function runTasks(
  crew: Crew,
  tasks: readonly TestFileTask[],
  cwd: string,
  write: (line: string) => void,
): Promise<TestRunReport["brokenFiles"]> {
  const broken: { file: string; error: string }[] = []

  await Promise.all(
    tasks.map((task) =>
      crew.testFile(task).catch((error: unknown) => {
        const file = relative(cwd, task.file)
        const message = String(error instanceof Error ? error.message : error)

        broken.push({ file, error: message })
        write(fileErrorLine(file, message))
      }),
    ),
  )

  return broken
}

/** Runs the tests; resolves to the process exit code. */
export async function runTests(options: RunTestsOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? printLine
  const loaded = await loadConfig(cwd, options.config)
  const entries = await selectedTests(loaded, options)

  if (entries.length === 0) {
    write("No tests found.")

    return 1
  }

  const { tasks, size } = planRun(loaded, options, entries)
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

  write(openingLine(entries.length, size))
  await tellReporters(reporters, (r) => r.started?.(context), write)

  let brokenFiles: TestRunReport["brokenFiles"] = []

  try {
    brokenFiles = await runTasks(crew, tasks, cwd, write)

    for (const line of closingLines(reports)) write(line)

    return brokenFiles.length > 0 || anyFailed(reports) ? 1 : 0
  } finally {
    await crew.disband()

    const reportPath = await closeRecording(recording, cwd, write)
    const run = { ...context, reports, brokenFiles, durationMs: Date.now() - began, reportPath }

    await tellReporters(reporters, (r) => r.testsFinished?.(run), write)
  }
}

/** One task per file, and how many workers they get: no more than there are files. */
function planRun(
  loaded: LoadedConfig,
  options: RunTestsOptions,
  entries: readonly CatalogEntry[],
): { tasks: TestFileTask[]; size: number } {
  const { cache } = loaded.config
  const tasks = tasksOf(entries, {
    retries: options.retries ?? loaded.config.retries ?? 0,
    cacheDir: cache && resolve(loaded.root, cache.dir),
  })

  return { tasks, size: Math.min(options.workers ?? loaded.config.workers ?? 1, tasks.length) }
}

/** The tests `options` select: by path fragment, then by a regular expression over their ids. */
function selectedTests(loaded: LoadedConfig, options: RunTestsOptions): Promise<CatalogEntry[]> {
  const grep = options.grep === undefined ? undefined : new RegExp(options.grep)

  return catalogOf(loaded, testFilesOf(loaded, options.patterns), grep)
}
