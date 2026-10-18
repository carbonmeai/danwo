/**
 * `danwo matrix`: one test, run once clean and then once per fault. The clean trial records the
 * agent's steps and shows every call and webhook the test causes; each becomes a planned fault.
 * Every faulted trial replays the recording with no model calls, in a freshly reset environment,
 * spread across the worker crew. A fault that never fired makes its trial invalid.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { availableParallelism, tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

import {
  checkFaultFired,
  type FaultMatrixResult,
  formatMatrix,
  type PlannedFault,
  planFaults,
  type RunOutcome,
} from "@danwo/core"

import type { CheckPace } from "../assert/pace.ts"
import { addUsage, cacheLine, modelLine, type Usage } from "../record/usage.ts"
import { type ErrorClass, exitCodeOf, notJudged } from "../support/codes.ts"
import { type CatalogEntry, catalogOf } from "./catalog.ts"
import { type DanwoConfig, type LoadedConfig, loadConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import { DEFAULT_WEBHOOK_FAULTS, defaultOutboundFaults } from "./faults.ts"
import type { RecordMode } from "./record.ts"
import { closeRecording, openRecording } from "./recording.ts"
import { type Reporter, type RunContext, tellReporters } from "./reporting.ts"
import type { TrialReport } from "./tasks.ts"
import { type TrialTimings, timingsLine } from "./timings.ts"
import { runPool, shuffledOrder } from "./trial-pool.ts"

/** Which test and which of its faults a matrix run covers. */
interface MatrixSelection {
  /** The test file; it must hold exactly one test after `grep`. */
  readonly file: string
  readonly grep?: string
  /** A regular expression over planned fault labels: only the faults it matches run. */
  readonly faults?: string
}

/** How the faulted trials are handed out. */
interface MatrixScheduling {
  /** Default: the config's `matrix.workers`, else its `workers`, else the machine's cores (at most 8). */
  readonly workers?: number
  /** Starts no new trial once this many failed (`--max-failures`). */
  readonly maxFailures?: number
  /** Runs the faulted trials in a shuffled order from this seed (`--shuffle`). */
  readonly shuffle?: number
}

export interface RunMatrixOptions extends MatrixSelection, MatrixScheduling {
  readonly cwd?: string
  readonly config?: string
  /** Flight recorder mode; overrides the config's `record`. */
  readonly record?: RecordMode
  /** Rewrite every `toHaveScreenshot` baseline (`--update-snapshots`). */
  readonly updateScreenshots?: boolean
  /** Reporters besides the config's, e.g. from `--reporter`. */
  readonly reporters?: readonly Reporter[]
  readonly write?: (line: string) => void
}

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

/**
 * A trial's outcome from its report. A failure whose class says nothing about the app (blocked,
 * inconclusive, infrastructure) makes the trial `not-judged` rather than `failed`.
 */
function outcomeOf(report: TrialReport, fault: PlannedFault | null): RunOutcome {
  const { errorClass, usage: _usage, timings: _timings, pace: _pace, ...rest } = report
  const unjudged = report.status === "failed" && errorClass !== undefined && notJudged(errorClass)

  return unjudged
    ? {
        ...rest,
        fault,
        status: "not-judged",
        error: `not judged (${errorClass}): ${report.error ?? ""}`,
      }
    : checkFaultFired({ ...rest, fault })
}

/** Runs trials on the crew; any trial that could not run at all is an environment error. */
function trialRunner(crew: Crew, run: MatrixRun) {
  return async (fault: PlannedFault | null): Promise<RunOutcome> => {
    try {
      const pace = fault === null ? undefined : run.pace.current
      const report = await crew.trial({
        file: run.file,
        testId: run.test.id,
        fault,
        cacheDir: run.cacheDir,
        ...(pace && { pace }),
      })

      keepTrialFacts(run, fault, report)

      return outcomeOf(report, fault)
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

/**
 * What the run keeps of a finished trial besides its outcome: its use of the cache and the model,
 * a faulted trial's timings, and the clean trial's check pace (for tests with an invariant, which
 * judges a faulted trial however early its body stopped).
 */
function keepTrialFacts(run: MatrixRun, fault: PlannedFault | null, report: TrialReport): void {
  if (report.usage !== undefined) run.usages.push(report.usage)

  if (fault !== null) {
    if (report.timings !== undefined) run.timings.push(report.timings)

    return
  }

  if (run.test.invariant) run.pace.current = paceFrom(report, run.loaded.config.matrix?.checkPace)
}

/** The pace faulted trials keep: the clean trial's check timings, unless the config turns it off. */
function paceFrom(
  report: TrialReport,
  setting: NonNullable<DanwoConfig["matrix"]>["checkPace"],
): CheckPace | undefined {
  if (setting === false || report.pace === undefined) return undefined

  return { took: report.pace, ...setting }
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

/** How the faulted trials are handed out. */
interface Dispatch {
  /** Trials at once: the crew's size. */
  readonly workers: number
  /** Starts no new trial once this many failed. */
  readonly maxFailures: number | undefined
  /** Runs the trials in a shuffled order from this seed. */
  readonly shuffle: number | undefined
}

/** The faulted trials over the crew; the ones that ran, in plan order, and how many did not. */
async function runPlan(
  plan: readonly PlannedFault[],
  run: (fault: PlannedFault | null) => Promise<RunOutcome>,
  dispatch: Dispatch,
  write: (line: string) => void,
): Promise<RunOutcome[]> {
  if (dispatch.shuffle !== undefined) write(`trials in shuffled order (seed ${dispatch.shuffle})`)

  const results = await runPool(plan, run, (o) => o.status === "failed", {
    size: dispatch.workers,
    ...(dispatch.shuffle !== undefined && { order: shuffledOrder(plan.length, dispatch.shuffle) }),
    ...(dispatch.maxFailures !== undefined && { stopAfter: dispatch.maxFailures }),
  })
  const ran = results.filter((outcome) => outcome !== undefined)
  const left = plan.length - ran.length

  if (left > 0)
    write(`stopped after ${dispatch.maxFailures} failed: ${left} planned faults not run`)

  return ran
}

/** What one matrix run's trials need besides the runner. */
interface TrialsSetup {
  readonly test: CatalogEntry
  readonly matrix: DanwoConfig["matrix"]
  readonly write: (line: string) => void
  /** Narrows the planned faults by label. */
  readonly filter: string | undefined
  readonly dispatch: Dispatch
}

/** The clean trial, then every planned fault's; the result and the exit code. */
async function runTrials(
  run: (fault: PlannedFault | null) => Promise<RunOutcome>,
  setup: TrialsSetup,
): Promise<{ result: FaultMatrixResult; code: number }> {
  const { matrix, write } = setup
  const began = Date.now()
  const clean = await run(null)

  if (clean.status !== "passed") {
    const result = { clean, runs: [] }

    write(formatMatrix(result))

    return { result, code: matrixExitCode([clean]) || 1 }
  }

  const planned = planFaults(
    clean,
    matrix?.outboundFaults ?? defaultOutboundFaults,
    matrix?.webhookFaults ?? DEFAULT_WEBHOOK_FAULTS,
  )
  const plan = selectFaults(planned, setup.filter)

  write(planLine(planned.length, plan.length, setup.filter))
  write(judgingLine(setup.test))

  const ran = await runPlan(plan, run, setup.dispatch, write)
  const runs = await retryInvalid(ran, matrix?.rerunInvalid ?? 0, run)
  const result = { clean, runs }

  write(formatMatrix(result))
  write(`${runs.length + 1} runs in ${Math.round((Date.now() - began) / 1000)} s`)

  return { result, code: matrixExitCode(runs) }
}

/** At most this many workers unless asked for more: each runs its own app, browser and emulators. */
const MAX_DEFAULT_WORKERS = 8

/** How many workers run the trials: asked for, configured, or one per core. */
function matrixWorkers(options: RunMatrixOptions, config: DanwoConfig): number {
  return (
    options.workers ??
    config.matrix?.workers ??
    config.workers ??
    Math.min(availableParallelism(), MAX_DEFAULT_WORKERS)
  )
}

/** The class a trial's status gives the run's exit code. */
const TRIAL_CLASS: Readonly<Record<RunOutcome["status"], ErrorClass | undefined>> = {
  passed: undefined,
  failed: "test",
  invalid: "blocked",
  "not-judged": "blocked",
  "environment-error": "infra",
}

/** 0 when every trial passed; otherwise the deciding failure's exit code (see codes.ts). */
function matrixExitCode(runs: readonly RunOutcome[]): number {
  return exitCodeOf(runs.flatMap((r) => TRIAL_CLASS[r.status] ?? []))
}

/** The run's `cache:` and `model:` lines over every trial, when any step used them. */
function usageLines(usages: readonly Usage[]): string[] {
  const usage = addUsage(usages)

  return [cacheLine(usage.cache), modelLine(usage)].filter((line) => line !== undefined)
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
  readonly dispatch: Dispatch
  /** Each finished trial's use of the cache and the model. */
  readonly usages: Usage[]
  /** Each finished faulted trial's time, phase by phase. */
  readonly timings: TrialTimings[]
  /** The clean trial's check timings, once it passed: they pace every faulted trial. */
  readonly pace: { current: CheckPace | undefined }
}

/** Runs the trials; tells the reporters when the run stopped without a result. */
async function trialsOrAbort(run: MatrixRun): Promise<{ result: FaultMatrixResult; code: number }> {
  try {
    const outcome = await runTrials(trialRunner(run.crew, run), {
      test: run.test,
      matrix: run.loaded.config.matrix,
      write: run.write,
      filter: run.faults,
      dispatch: run.dispatch,
    })

    for (const line of usageLines(run.usages)) run.write(line)

    const timeLine = timingsLine(run.timings)

    if (timeLine !== undefined) run.write(timeLine)

    return outcome
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
  const workers = matrixWorkers(options, loaded.config)
  const crew = new Crew({
    size: workers,
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
    dispatch: { workers, maxFailures: options.maxFailures, shuffle: options.shuffle },
    usages: [],
    timings: [],
    pace: { current: undefined },
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
