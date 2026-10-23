/**
 * `danwo merge-reports`: joins the results of a split run (`danwo test --shard i/n` on several
 * machines) into one report, told to the reporters once, so CI shows one check for the run.
 */
import { readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { loadConfig } from "./config.ts"
import { closingLines, runExitCode } from "./reporter.ts"
import { type Reporter, suiteOf, tellReporters } from "./reporting.ts"
import { lastRunPath, mergeResults, readResults, type RunResults } from "./results.ts"

export interface MergeReportsOptions {
  readonly cwd?: string
  readonly config?: string
  /** Results files; default every `shard-*.json` under `.danwo/results`. */
  readonly files?: readonly string[]
  /** Reporters besides the config's, e.g. from `--reporter`. */
  readonly reporters?: readonly Reporter[]
  /** `--name`: the suite's name for the reporters; overrides the config's `name`. */
  readonly name?: string
  readonly write?: (line: string) => void
}

const printLine = (line: string) => process.stdout.write(`${line}\n`)

/** The shard results files under the project, in shard order. */
async function shardFilesOf(root: string): Promise<string[]> {
  const dir = dirname(lastRunPath(root))
  const names = await readdir(dir).catch(() => [])

  return names
    .filter((name) => /^shard-\d+-of-\d+\.json$/.test(name))
    .toSorted((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))
    .map((name) => join(dir, name))
}

/** Merges the shards' results, prints the summary and tells the reporters; resolves to the exit code. */
export async function mergeReports(options: MergeReportsOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? printLine
  const loaded = await loadConfig(cwd, options.config)
  const files =
    options.files === undefined || options.files.length === 0
      ? await shardFilesOf(loaded.root)
      : options.files.map((file) => resolve(cwd, file))
  const runs = (await Promise.all(files.map((file) => readResults(file)))).filter(
    (run): run is RunResults => run !== undefined,
  )

  if (runs.length === 0) {
    write("No results to merge: run danwo test --shard i/n first.")

    return 1
  }

  const merged = mergeResults(runs)
  const reporters = [...(loaded.config.reporters ?? []), ...(options.reporters ?? [])]
  const context = {
    kind: "test",
    root: loaded.root,
    cwd,
    ...suiteOf(options.name, loaded.config),
  } as const

  write(`merged ${runs.length} result file${runs.length === 1 ? "" : "s"}`)
  for (const line of closingLines(merged.reports)) write(line)

  await tellReporters(reporters, (r) => r.started?.(context), write)
  await tellReporters(
    reporters,
    (r) => r.testsFinished?.({ ...context, ...merged, reportPath: undefined }),
    write,
  )

  return runExitCode(merged.reports, merged.brokenFiles)
}
