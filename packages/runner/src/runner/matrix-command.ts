/**
 * `danwo matrix`: one test, run once clean and then once per fault. The clean trial records the
 * agent's steps and shows every call and webhook the test causes; each becomes a planned fault.
 * Every faulted trial replays the recording with no model calls, in a freshly reset environment,
 * spread across the worker crew. A fault that never fired makes its trial invalid.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

import {
  checkFaultFired,
  type FaultMatrixResult,
  formatMatrix,
  type PlannedFault,
  planFaults,
  type RunOutcome,
} from "@danwo/core"
import type { WebhookFault } from "@danwo/emulators"

import { type CatalogEntry, catalogOf } from "./catalog.ts"
import { type DanwoConfig, type LoadedConfig, loadConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import { defaultOutboundFaults } from "./faults.ts"
import type { RecordMode } from "./record.ts"
import { closeRecording, openRecording } from "./recording.ts"
import { type Reporter, type RunContext, tellReporters } from "./reporting.ts"

export interface RunMatrixOptions {
  readonly cwd?: string
  readonly config?: string
  /** The test file; it must hold exactly one test after `grep`. */
  readonly file: string
  readonly grep?: string
  /** A regular expression over planned fault labels: only the faults it matches run. */
  readonly faults?: string
  readonly workers?: number
  /** Flight recorder mode; overrides the config's `record`. */
  readonly record?: RecordMode
  /** Rewrite every `toHaveScreenshot` baseline (`--update-snapshots`). */
  readonly updateScreenshots?: boolean
  /** Reporters besides the config's, e.g. from `--reporter`. */
  readonly reporters?: readonly Reporter[]
  readonly write?: (line: string) => void
}

/** Webhook faults when the config names none: a repeat, a late one, a forgery, an old one. */
const WEBHOOK_FAULTS: readonly WebhookFault[] = [
  { kind: "duplicate" },
  { kind: "delay", ms: 10 * 60_000 },
  { kind: "forged" },
  { kind: "stale", seconds: 3600 },
]

const printLine = (line: string) => process.stdout.write(`${line}\n`)

async function theTest(
  loaded: LoadedConfig,
  file: string,
  options: RunMatrixOptions,
): Promise<CatalogEntry> {
  const grep = options.grep === undefined ? undefined : new RegExp(options.grep)
  const entries = await catalogOf(loaded, [file], grep)
  const [only] = entries

  if (entries.length !== 1 || only === undefined) {
    throw new Error(
      `danwo matrix runs one test; ${entries.length} matched in ${options.file} (use --grep)`,
    )
  }

  return only
}

/** How faulted trials are judged, printed once the plan is known. */
function judgingLine(test: CatalogEntry): string {
  return test.invariant
    ? "faulted runs stop at their first breaking step; the test's invariant judges them"
    : "no invariant: the body must pass under every fault (add test(...).invariant(fn) to judge outcomes instead)"
}

/** Runs trials on the crew; any trial that could not run at all is an environment error. */
function trialRunner(crew: Crew, file: string, testId: string, cacheDir: string) {
  return async (fault: PlannedFault | null): Promise<RunOutcome> => {
    try {
      const report = await crew.trial({ file, testId, fault, cacheDir })

      return checkFaultFired({ ...report, fault })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return {
        fault,
        status: "environment-error",
        error: message,
        exchanges: [],
        deliveries: [],
        notes: [],
      }
    }
  }
}

/** Runs the invalid trials again, up to `rounds` times, keeping each in its place. */
async function retryInvalid(
  outcomes: readonly RunOutcome[],
  rounds: number,
  run: (fault: PlannedFault | null) => Promise<RunOutcome>,
): Promise<RunOutcome[]> {
  let current = [...outcomes]

  for (let round = 0; round < rounds && current.some((o) => o.status === "invalid"); round++) {
    current = await Promise.all(
      current.map((o) => (o.status === "invalid" ? run(o.fault) : Promise.resolve(o))),
    )
  }

  return current
}

/** Where trials share their recording: the config's cache, else a folder for this run alone. */
async function trialCache(loaded: LoadedConfig): Promise<{ dir: string; done(): Promise<void> }> {
  const { cache } = loaded.config

  if (cache !== undefined) return { dir: resolve(loaded.root, cache.dir), done: async () => {} }

  const dir = await mkdtemp(join(tmpdir(), "danwo-matrix-"))

  return { dir, done: () => rm(dir, { recursive: true, force: true }) }
}

/** The planned faults whose labels `filter` matches; every one without a filter. */
function selectFaults(plan: readonly PlannedFault[], filter: string | undefined): PlannedFault[] {
  if (filter === undefined) return [...plan]

  const pattern = new RegExp(filter)

  return plan.filter((fault) => pattern.test(fault.label))
}

/** The line announcing the plan, naming the filter when one narrowed it. */
function planLine(planned: number, kept: number, filter: string | undefined): string {
  return filter === undefined
    ? `clean run passed; ${planned} faults planned`
    : `clean run passed; ${kept} of ${planned} planned faults match /${filter}/`
}

/** The clean trial, then every planned fault's; the result and the exit code. */
async function runTrials(
  test: CatalogEntry,
  matrix: DanwoConfig["matrix"],
  run: (fault: PlannedFault | null) => Promise<RunOutcome>,
  write: (line: string) => void,
  filter: string | undefined,
): Promise<{ result: FaultMatrixResult; code: number }> {
  const began = Date.now()
  const clean = await run(null)

  if (clean.status !== "passed") {
    const result = { clean, runs: [] }

    write(formatMatrix(result))

    return { result, code: 1 }
  }

  const planned = planFaults(
    clean,
    matrix?.outboundFaults ?? defaultOutboundFaults,
    matrix?.webhookFaults ?? WEBHOOK_FAULTS,
  )
  const plan = selectFaults(planned, filter)

  write(planLine(planned.length, plan.length, filter))
  write(judgingLine(test))

  const runs = await retryInvalid(await Promise.all(plan.map(run)), matrix?.rerunInvalid ?? 0, run)
  const result = { clean, runs }

  write(formatMatrix(result))
  write(`${runs.length + 1} runs in ${Math.round((Date.now() - began) / 1000)} s`)

  return { result, code: runs.every((r) => r.status === "passed") ? 0 : 1 }
}

/** Everything a matrix run holds while its trials run. */
interface MatrixRun {
  readonly loaded: LoadedConfig
  readonly file: string
  readonly test: CatalogEntry
  readonly crew: Crew
  readonly cacheDir: string
  readonly reporters: readonly Reporter[]
  readonly context: RunContext
  readonly began: number
  readonly write: (line: string) => void
  /** Narrows the planned faults by label. */
  readonly faults: string | undefined
}

/** Runs the trials; tells the reporters when the run stopped without a result. */
async function trialsOrAbort(run: MatrixRun): Promise<{ result: FaultMatrixResult; code: number }> {
  try {
    return await runTrials(
      run.test,
      run.loaded.config.matrix,
      trialRunner(run.crew, run.file, run.test.id, run.cacheDir),
      run.write,
      run.faults,
    )
  } catch (error) {
    const aborted = {
      ...run.context,
      error: error instanceof Error ? error.message : String(error),
    }

    await tellReporters(run.reporters, (r) => r.aborted?.(aborted), run.write)
    throw error
  }
}

/** Gives the reporters the finished matrix. */
function reportMatrix(
  run: MatrixRun,
  result: FaultMatrixResult,
  reportPath: string | undefined,
): Promise<void> {
  const report = {
    ...run.context,
    kind: "matrix",
    testId: run.test.id,
    file: relative(run.loaded.root, run.file),
    result,
    durationMs: Date.now() - run.began,
    reportPath,
  } as const

  return tellReporters(run.reporters, (r) => r.matrixFinished?.(report), run.write)
}

/** Runs the matrix; resolves to its result and the process exit code. */
export async function runMatrix(
  options: RunMatrixOptions,
): Promise<{ result: FaultMatrixResult; code: number }> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? printLine
  const loaded = await loadConfig(cwd, options.config)
  const file = resolve(cwd, options.file)
  const test = await theTest(loaded, file, options)
  const cache = await trialCache(loaded)
  const recording = openRecording(loaded, options.record)
  const crew = new Crew({
    size: options.workers ?? loaded.config.workers ?? 1,
    start: {
      cwd,
      configPath: loaded.path,
      record: recording,
      updateScreenshots: options.updateScreenshots ?? false,
    },
  })
  const run: MatrixRun = {
    loaded,
    file,
    test,
    crew,
    cacheDir: cache.dir,
    reporters: [...(loaded.config.reporters ?? []), ...(options.reporters ?? [])],
    context: { kind: "matrix", root: loaded.root, cwd },
    began: Date.now(),
    write,
    faults: options.faults,
  }

  await tellReporters(run.reporters, (r) => r.started?.(run.context), write)

  let outcome: { result: FaultMatrixResult; code: number } | undefined

  try {
    outcome = await trialsOrAbort(run)

    return outcome
  } finally {
    await crew.disband()

    const reportPath = await closeRecording(recording, cwd, write)

    await cache.done()
    if (outcome !== undefined) await reportMatrix(run, outcome.result, reportPath)
  }
}
