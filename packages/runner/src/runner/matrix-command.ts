/**
 * `danwo matrix`: one test, run once clean and then once per fault. The clean trial records the
 * agent's steps and shows every call and webhook the test causes; each becomes a planned fault.
 * Every faulted trial replays the recording with no model calls, in a freshly reset environment,
 * spread across the worker crew. A fault that never fired makes its trial invalid.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { availableParallelism, tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"

import {
  bodyOf,
  checkFaultFired,
  type FaultMatrixResult,
  type FocusedPlan,
  focusLines,
  type FocusOptions,
  focusPlan,
  formatMatrix,
  type PlannedFault,
  type PlanSummary,
  planFaults,
  planRaceFaults,
  type RaceEvidence,
  type RunOutcome,
  setupSize,
} from "@danwo/matrix"

import type { CheckPace } from "../assert/pace.ts"
import { lintReport, withLint } from "../lint/index.ts"
import { addUsage, cacheLine, modelLine, type Usage } from "../record/usage.ts"
import { type ErrorClass, exitCodeOf, notJudged } from "../support/codes.ts"
import { type CatalogEntry, catalogOf } from "./catalog.ts"
import { type DanwoConfig, type LoadedConfig, loadConfig } from "./config.ts"
import { Crew } from "./crew.ts"
import { type CleanCost, estimateText, estimateTrials } from "./estimate.ts"
import { DEFAULT_WEBHOOK_FAULTS, defaultDataFaults, defaultOutboundFaults } from "./faults.ts"
import { historyReporter } from "./history.ts"
import { type LiveFeed, newRunId, openLiveFeed } from "./live.ts"
import { racePlan } from "./races.ts"
import { closeRecording, openRecording, recordingContext } from "./recording.ts"
import {
  type Reporter,
  type RunCommandOptions,
  type RunContext,
  tellReporters,
  type TrialFindings,
} from "./reporting.ts"
import type { TrialReport } from "./tasks.ts"
import { noTimings, type TrialTimings, timingsLine } from "./timings.ts"
import { runPool, shuffledOrder } from "./trial-pool.ts"

/** Which test and which of its faults a matrix run covers. */
interface MatrixSelection {
  /** The test file; it must hold exactly one test after `grep`. */
  readonly file: string
  readonly grep?: string
  /** A regular expression over planned fault labels: only the faults it matches run. */
  readonly faults?: string
  /** Plans faults on setup too: the saved session signing in, fixtures, `beforeEach`. */
  readonly includeSetup?: boolean
  /** Most faulted trials (default: the config's `matrix.budget`, else 40). */
  readonly budget?: number
  /** Every fault on the body, background work included, with no budget. */
  readonly all?: boolean
  /** Every fault kind on each target, not only the most telling ones. */
  readonly thorough?: boolean
  /** Faults on every occurrence of a route or statement, not only its first. */
  readonly everyOccurrence?: boolean
  /** Runs the clean trial, prints the plan and the time it would take, and runs no faults. */
  readonly plan?: boolean
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

export interface RunMatrixOptions extends MatrixSelection, MatrixScheduling, RunCommandOptions {}

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
  const {
    errorClass,
    usage: _usage,
    timings: _timings,
    restoreMs: _restoreMs,
    pace: _pace,
    lint: _lint,
    races: _races,
    ...rest
  } = report
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
        ...(run.focus.includeSetup && { includeSetup: true }),
        ...(fault === null && run.focus.preview && { timeRestore: true }),
      })

      keepTrialFacts(run, fault, report)

      return told(run, outcomeOf(report, fault))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return told(run, {
        fault,
        status: "environment-error",
        error: message,
        exchanges: [],
        deliveries: [],
        notes: [],
      })
    }
  }
}

/** Puts a finished trial on the live feed. */
function told(run: MatrixRun, outcome: RunOutcome): RunOutcome {
  run.feed.write({
    type: "trial",
    at: new Date().toISOString(),
    fault: outcome.fault?.label ?? null,
    status: outcome.status,
  })

  return outcome
}

/**
 * What the run keeps of a finished trial besides its outcome: its use of the cache and the model,
 * a faulted trial's timings, and the clean trial's check pace (for tests with an invariant, which
 * judges a faulted trial however early its body stopped).
 */
function keepTrialFacts(run: MatrixRun, fault: PlannedFault | null, report: TrialReport): void {
  if (report.usage !== undefined) run.usages.push(report.usage)
  if (report.lint !== undefined)
    run.lint.push({ trial: fault?.label ?? "clean", findings: report.lint })

  if (fault !== null) {
    if (report.timings !== undefined) run.timings.push(report.timings)

    return
  }

  keepCleanFacts(run, report)
}

/** What the run keeps of its clean trial: its races, its phases and its check pace. */
function keepCleanFacts(run: MatrixRun, report: TrialReport): void {
  run.races.current = report.races
  if (report.timings !== undefined)
    run.clean.current = { timings: report.timings, restoreMs: report.restoreMs }
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
function planLine(kept: number, of: number, filter: string | undefined): string {
  return filter === undefined
    ? `clean run passed; ${kept} faults planned`
    : `clean run passed; ${kept} of ${of} planned faults match /${filter}/`
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
  readonly focus: PlanFocus
  readonly dispatch: Dispatch
  /** What the clean trial showed from the browser's side, once it ran. */
  readonly races: () => RaceEvidence | undefined
  /** Hears how many faulted trials will run, once they are planned. */
  readonly planned?: (count: number) => void
  /** What the clean trial measured, once it ran: what `--plan` estimates the trials from. */
  readonly cleanTrial?: () => CleanTrial | undefined
}

/** The clean trial's phases and, when it was timed, one restore of the kept starting state. */
type CleanTrial = Omit<CleanCost, "startMs">

/** How the plan is focused, and whether the run stops once it is printed. */
interface PlanFocus extends FocusOptions {
  readonly includeSetup: boolean
  readonly preview: boolean
}

/** Every fault `outcome` allows: one per call, delivery, statement and socket, then the races. */
function planOn(outcome: RunOutcome, setup: TrialsSetup): PlannedFault[] {
  const { matrix } = setup

  return [
    ...planFaults(
      outcome,
      matrix?.outboundFaults ?? defaultOutboundFaults,
      matrix?.webhookFaults ?? DEFAULT_WEBHOOK_FAULTS,
      matrix?.dataFaults ?? defaultDataFaults,
    ),
    ...planRaceFaults(outcome, racePlan(matrix, setup.test, setup.races())),
  ]
}

/**
 * The faults to run: those on the test's body (all of the run with `includeSetup`), narrowed by
 * the label filter, then focused under the budget.
 */
function planAll(clean: RunOutcome, setup: TrialsSetup): { focused: FocusedPlan; of: number } {
  const { focus } = setup
  const body = focus.includeSetup ? clean : bodyOf(clean)
  const unfiltered = planOn(body, setup)
  const planned = selectFaults(unfiltered, setup.filter)
  const onSetup =
    focus.includeSetup || setupSize(clean.setup) === 0
      ? 0
      : Math.max(0, selectFaults(planOn(clean, setup), setup.filter).length - planned.length)

  return { focused: focusPlan(planned, onSetup, focus), of: unfiltered.length }
}

/** The counts the matrix result keeps of how its plan was focused. */
function summaryOf(focused: FocusedPlan): PlanSummary {
  const { skipped } = focused

  return {
    total: focused.total,
    planned: focused.trials.length,
    skipped: {
      setup: skipped.setup,
      background: skipped.background,
      repeats: skipped.repeats,
      kinds: skipped.kinds,
      budget: skipped.budget.length,
    },
  }
}

/**
 * The plan as `--plan` prints it: each trial, what was left out, and about how long the trials
 * would take on the crew, from what the clean run measured.
 */
function previewLines(focused: FocusedPlan, cost: CleanCost, workers: number): string[] {
  const count = focused.trials.length
  const took = estimateText(estimateTrials(focused.trials, cost, workers))

  return [
    ...focused.trials.map((fault) => `  ${fault.label}`),
    ...(focused.skipped.budget.length > 0
      ? [
          `over the budget: ${focused.skipped.budget.slice(0, 10).join("; ")}${focused.skipped.budget.length > 10 ? "; …" : ""}`,
        ]
      : []),
    `${took} for ${count} trials on ${workers} workers`,
  ]
}

/**
 * What the clean run cost: its phases, and the rest of its whole time as the worker's start. A
 * clean trial that kept no phases counts its whole time as its body.
 */
function cleanCost(trial: CleanTrial | undefined, cleanMs: number): CleanCost {
  if (trial === undefined) return { timings: { ...noTimings(), body: cleanMs }, startMs: 0 }

  const phases = Object.values(trial.timings).reduce((sum, ms) => sum + ms, 0)

  return { ...trial, startMs: Math.max(0, cleanMs - phases) }
}

/**
 * Plans the faulted trials from the clean one and says so: how many, what was left out and, for
 * a preview, each trial and the time they would take. The trials, and the plan's summary for the
 * result when it left anything out.
 */
function announcePlan(
  clean: RunOutcome,
  setup: TrialsSetup,
  cleanMs: number,
): { plan: readonly PlannedFault[]; summary: { plan?: PlanSummary } } {
  const { write } = setup
  const { focused, of } = planAll(clean, setup)
  const plan = focused.trials

  setup.planned?.(plan.length)
  write(planLine(plan.length, of, setup.filter))
  for (const line of focusLines(focused)) write(line)
  if (setup.focus.preview)
    for (const line of previewLines(
      focused,
      cleanCost(setup.cleanTrial?.(), cleanMs),
      setup.dispatch.workers,
    ))
      write(line)

  return { plan, summary: focused.total === plan.length ? {} : { plan: summaryOf(focused) } }
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

  const { plan, summary } = announcePlan(clean, setup, Date.now() - began)

  if (setup.focus.preview) return { result: { clean, runs: [], ...summary }, code: 0 }

  write(judgingLine(setup.test))

  const ran = await runPlan(plan, run, setup.dispatch, write)
  const runs = await retryInvalid(ran, matrix?.rerunInvalid ?? 0, run)
  const result = { clean, runs, ...summary }

  write(formatMatrix(result))
  write(`${runs.length + 1} runs in ${Math.round((Date.now() - began) / 1000)} s`)

  return { result, code: matrixExitCode(runs) }
}

/** How the run focuses its plan: the flags, then the config's `matrix.budget`. */
function focusOf(options: RunMatrixOptions, config: DanwoConfig): PlanFocus {
  const budget = options.budget ?? config.matrix?.budget

  return {
    includeSetup: options.includeSetup === true,
    preview: options.plan === true,
    ...(budget !== undefined && { budget }),
    ...(options.all === true && { all: true }),
    ...(options.thorough === true && { thorough: true }),
    ...(options.everyOccurrence === true && { everyOccurrence: true }),
  }
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
  /** How the plan is focused, and whether the run stops at the plan. */
  readonly focus: PlanFocus
  readonly dispatch: Dispatch
  /** Each finished trial's use of the cache and the model. */
  readonly usages: Usage[]
  /** Each finished faulted trial's time, phase by phase. */
  readonly timings: TrialTimings[]
  /** The clean trial's check timings, once it passed: they pace every faulted trial. */
  readonly pace: { current: CheckPace | undefined }
  /** Each trial's integration lint findings. */
  readonly lint: TrialFindings[]
  /** The clean trial's browser-side evidence, once it ran: what races are planned from. */
  readonly races: { current: RaceEvidence | undefined }
  /** The clean trial's phases, once it ran: what a plan preview estimates the trials from. */
  readonly clean: { current: CleanTrial | undefined }
  /** Where the run says what it is doing as it does it. */
  readonly feed: LiveFeed
}

/** Runs the trials; tells the reporters when the run stopped without a result. */
async function trialsOrAbort(run: MatrixRun): Promise<{ result: FaultMatrixResult; code: number }> {
  try {
    const outcome = await runTrials(trialRunner(run.crew, run), {
      test: run.test,
      matrix: run.loaded.config.matrix,
      write: run.write,
      filter: run.faults,
      focus: run.focus,
      dispatch: run.dispatch,
      races: () => run.races.current,
      cleanTrial: () => run.clean.current,
      planned: (count) =>
        run.feed.write({ type: "plan", at: new Date().toISOString(), planned: count + 1 }),
    })

    for (const line of usageLines(run.usages)) run.write(line)

    const timeLine = timingsLine(run.timings)

    if (timeLine !== undefined) run.write(timeLine)

    const findings = run.lint.flatMap((trial) => trial.findings)

    for (const line of lintReport(findings)) run.write(line)

    return { ...outcome, code: withLint(outcome.code, findings, run.loaded.config.lint) }
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
    usage: addUsage(run.usages),
    judgedBy: run.test.invariant ? "invariant" : "body",
    ...(run.lint.length > 0 && { lint: run.lint }),
  } as const

  return tellReporters(run.reporters, (r) => r.matrixFinished?.(report), run.write)
}

/** The crew a matrix's trials go to, each worker started for this project and its recording. */
function matrixCrew(setup: {
  readonly loaded: LoadedConfig
  readonly options: RunMatrixOptions
  readonly cwd: string
  readonly recording: ReturnType<typeof openRecording>
  readonly workers: number
  readonly feed: LiveFeed
}): Crew {
  const { options } = setup

  return new Crew({
    size: setup.workers,
    start: {
      cwd: setup.cwd,
      configPath: setup.loaded.path,
      record: setup.recording,
      updateScreenshots: options.updateScreenshots ?? false,
      ...(options.lint !== undefined && { lint: options.lint }),
    },
    onLive: (event) => setup.feed.write(event),
  })
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
  const recording = openRecording(loaded, options.record, options.video, options.keepRuns)
  const workers = matrixWorkers(options, loaded.config)
  const id = recording === undefined ? newRunId() : basename(recording.runDir)
  const feed = await openLiveFeed(loaded.root, { id, kind: "matrix", title: test.id, planned: 1 })
  const crew = matrixCrew({ loaded, options, cwd, recording, workers, feed })
  const run: MatrixRun = {
    loaded,
    file,
    test,
    crew,
    cacheDir: cache.dir,
    reporters: [
      historyReporter(),
      ...(loaded.config.reporters ?? []),
      ...(options.reporters ?? []),
    ],
    context: { kind: "matrix", root: loaded.root, cwd, id, ...recordingContext(recording) },
    began: Date.now(),
    write,
    faults: options.faults,
    focus: focusOf(options, loaded.config),
    dispatch: { workers, maxFailures: options.maxFailures, shuffle: options.shuffle },
    usages: [],
    timings: [],
    pace: { current: undefined },
    lint: [],
    races: { current: undefined },
    clean: { current: undefined },
    feed,
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
    /* A plan preview ran no faults: it is no matrix result for the run history. */
    if (outcome !== undefined && !run.focus.preview)
      await reportMatrix(run, outcome.result, reportPath)
    await feed.finish(outcome?.code ?? 1, Date.now() - run.began)
  }
}
