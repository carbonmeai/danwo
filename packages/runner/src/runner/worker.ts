/**
 * A worker process. It loads the project's config, starts the config's environment once, and then
 * answers tasks one at a time: a test file for `danwo test`, a trial for `danwo matrix`. Tests run
 * here, so their functions never leave the process; only plain reports go back.
 */
import { basename, dirname, join } from "node:path"

import {
  applyFault,
  clearDataFaults,
  clearWebhookFaults,
  dataCallsOf,
  deliveriesOf,
  faultFired,
  type RunOutcome,
} from "@danwo/matrix"
import type { Proxy } from "@danwo/proxy"
import type { Browser } from "playwright-core"

import { type CheckPace, paceOf } from "../assert/pace.ts"
import { launchBrowser } from "../browser/index.ts"
import { type LintConfig, type LintFinding, lint } from "../lint/index.ts"
import type { StepRecord } from "../record/index.ts"
import { usageOf } from "../record/usage.ts"
import { keepsVideo } from "../record/video.ts"
import {
  type DeclaredTest,
  type FileDeclarations,
  isolationOf,
  suiteHooks,
} from "../tests/registry.ts"
import { resultOf, worthRetrying } from "../tests/retry.ts"
import { type AttemptResult, type AttemptSetup, runAttempt, type ReplayUse } from "./attempt.ts"
import { loadTestFile, testIdOf } from "./catalog.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import type { WorkerEnvironment } from "./environment.ts"
import { impactOf } from "./impact.ts"
import { type Isolation, StartingPoint } from "./isolation.ts"
import { LiveTap } from "./live.ts"
import { trialRace } from "./races.ts"
import {
  attemptDir,
  buildRecord,
  type EvidenceMark,
  finishRecord,
  type FlightRecord,
  markEvidence,
  recordEvidence,
  type RecordExtras,
  type RecordInput,
  type RecordSettings,
} from "./record.ts"
import { SessionKeeper } from "./sessions.ts"
import type {
  AttemptReport,
  TestFileTask,
  TestImpact,
  TestReport,
  TrialReport,
  TrialTask,
  WorkerCalls,
  WorkerStart,
} from "./tasks.ts"
import { noTimings, TRIAL_PHASES, type TrialPhase, timed } from "./timings.ts"
import { answerCalls, sendNote } from "./wire.ts"

/** What `beforeAll` and `afterAll` receive: there is no browser session outside a test. */
const SUITE_FIXTURES = { platform: "web" }

/** The worker's project and environment, set by `start`. */
interface Bench {
  readonly loaded: LoadedConfig
  readonly env: WorkerEnvironment | undefined
  readonly workerIndex: number
  /** Undefined when the run records nothing. */
  readonly recording: RecordSettings | undefined
  readonly updateScreenshots: boolean
  /** Saved sessions, kept across this worker's tests until the environment resets. */
  readonly sessions: SessionKeeper
  /** The integration lint's settings; undefined when the run does not lint. */
  readonly lint: LintConfig | undefined
  /** Where every test and trial starts; undefined without an environment. */
  readonly start: StartingPoint | undefined
}

/**
 * Whether a saved session's sign-in is kept in the starting point: while tests run, so later
 * tests reuse it after a restore. A matrix trial runs under a fault, so its sign-ins are not kept.
 */
let keepSignIns = false

let bench: Bench | undefined
/** The worker's browser, launched on first use; each attempt opens its own context in it. */
let browser: Promise<Browser> | undefined

/** The worker's browser behind its environment's proxy, launched again if it went away. */
async function workerBrowser(): Promise<Browser> {
  const current = await browser?.catch(() => undefined)

  if (current?.isConnected()) return current

  const proxy = benchOrFail().env?.proxy

  browser = launchBrowser(proxy && { proxy: { url: proxy.url, caSpki: proxy.caSpki } })

  return browser
}

function benchOrFail(): Bench {
  if (bench === undefined) throw new Error("the worker was given a task before it started")

  return bench
}

function findDeclared(declarations: FileDeclarations, file: string, id: string): DeclaredTest {
  const root = benchOrFail().loaded.root
  const test = declarations.tests.find((candidate) => testIdOf(root, file, candidate) === id)

  if (test === undefined) throw new Error(`test not found: ${id}`)

  return test
}

/** What a trial adds to one of its attempts: a race in its browser, or its place among several users. */
type AttemptExtras = Partial<
  Pick<AttemptSetup, "onContext" | "beforeInvariant" | "skipInvariant">
> & {
  /** Keeps no flight record: another attempt of the same trial keeps the trial's. */
  readonly unrecorded?: boolean
}

/** One attempt of `id`, with its flight record directory when the run records. */
async function attemptOnce(
  declarations: FileDeclarations,
  file: string,
  id: string,
  replay: ReplayUse,
  recordAs: string,
  checkPace?: CheckPace,
  extras: AttemptExtras = {},
): Promise<{ result: AttemptResult; recordDir: string | undefined; mark: EvidenceMark }> {
  const { loaded, env, recording, updateScreenshots, sessions } = benchOrFail()
  const { unrecorded, ...race } = extras
  const recordDir =
    unrecorded === true ? undefined : recording && attemptDir(recording, id, recordAs)
  const mark = markEvidence(env)
  const test = findDeclared(declarations, file, id)
  // Another user's attempt in a race trial runs alongside the one the feed follows.
  const tap =
    unrecorded === true
      ? undefined
      : new LiveTap({ test: id, attempt: recordAs }, env, mark, (data) =>
          sendNote({ topic: "live", data }),
        )
  const result = await runAttempt(declarations, test, {
    id,
    config: loaded.config,
    root: loaded.root,
    env,
    replay,
    recordDir,
    recordVideo: recording?.video !== undefined && recording.video !== "off",
    screenshots: {
      dir: baselineDir(file, test.titlePath),
      update: updateScreenshots ? "all" : "missing",
    },
    sessions,
    browser: workerBrowser,
    ...(checkPace && { checkPace }),
    ...(tap && { onStep: (step: StepRecord) => tap.step(step) }),
    ...race,
  }).finally(() => tap?.stop())

  tap?.end(result.status, result.durationMs)

  return { result, recordDir, mark }
}

/** A test's baselines: `__screenshots__/<file>/<test>/` next to its file. */
function baselineDir(file: string, titlePath: readonly string[]): string {
  const name = titlePath
    .join(" ")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")

  return join(dirname(file), "__screenshots__", basename(file), name || "test")
}

/**
 * Lints a run when the run lints: gathers its redacted evidence once, so the record (when kept)
 * reuses it rather than redacting everything again.
 */
function inspect(input: RecordInput): RecordExtras {
  const config = benchOrFail().lint

  if (config === undefined) return {}

  const evidence = recordEvidence(input)
  const subject = { run: input.run, status: input.status, stopped: input.stopped, ...evidence }

  return { evidence, lint: lint(subject, config) }
}

/** A report's `lint` field: the findings, when there are any. */
function lintOf(extras: RecordExtras): { lint?: readonly LintFinding[] } {
  return extras.lint !== undefined && extras.lint.length > 0 ? { lint: extras.lint } : {}
}

/** Whether a run's record keeps its video, by the recording's video mode and whether it passed. */
function videoKept(passed: boolean): boolean {
  const mode = benchOrFail().recording?.video

  return mode !== undefined && keepsVideo(mode, passed)
}

/** Keeps or drops a run's flight record; the directory relative to the cwd when kept. */
function keepRecord(
  recordDir: string | undefined,
  failed: boolean,
  build: () => FlightRecord,
): Promise<string | undefined> {
  const { recording } = benchOrFail()

  if (recordDir === undefined || recording === undefined) return Promise.resolve(undefined)

  return finishRecord(recordDir, recording.mode, failed, build)
}

/** Whether the environment is at its starting point: nothing ran since the last clean, keep or restore. */
let untouched = false

/** Back to the starting point before an attempt, unless the environment is still there. */
async function fromStart(): Promise<void> {
  const { start } = benchOrFail()

  if (start === undefined || untouched) return

  await start.again()
  untouched = true
}

/**
 * Readies the environment for an attempt: restored first when the test is isolated. A sign-in
 * the attempt makes is kept in the starting point only when the attempt began from it.
 */
async function beginAttempt(isolated: boolean): Promise<void> {
  if (isolated) await fromStart()
  keepSignIns = untouched
  untouched = false
}

/** A test with its retries; every retry loads the file afresh. `isolated` restores before each. */
async function runTest(
  task: TestFileTask,
  first: FileDeclarations,
  id: string,
  isolated: boolean,
): Promise<TestReport> {
  const { env, workerIndex } = benchOrFail()
  const replay: ReplayUse =
    task.cacheDir === undefined
      ? { kind: "none" }
      : { kind: "learn", dir: task.cacheDir, readOnly: task.cacheReadOnly ?? false }
  const tries = 1 + (findDeclared(first, task.file, id).options.retries ?? task.retries)
  const attempts: AttemptReport[] = []
  let impact: TestImpact | undefined

  for (let n = 1; n <= tries; n++) {
    const declarations = n === 1 ? first : await loadTestFile(task.file)

    await beginAttempt(isolated)

    const { result, recordDir, mark } = await attemptOnce(
      declarations,
      task.file,
      id,
      replay,
      `attempt-${n}`,
    ).finally(() => {
      keepSignIns = false
    })
    const input: RecordInput = {
      test: id,
      run: { kind: "test", attempt: n },
      status: result.status,
      error: result.error,
      stopped: result.stopped,
      divergence: result.divergence,
      notes: result.notes,
      durationMs: result.durationMs,
      flight: result.flight,
      env,
      mark,
      video: videoKept(result.status === "passed"),
    }
    const inspected = inspect(input)
    const record = await keepRecord(recordDir, result.status !== "passed", () =>
      buildRecord(input, inspected),
    )

    attempts.push({
      status: result.status,
      error: result.error,
      durationMs: result.durationMs,
      record,
      usage: usageOf(result.flight.session.steps()),
      ...lintOf(inspected),
    })

    if (result.status === "passed") impact = attemptImpact(result, mark)
    if (!worthRetrying(result.status)) break
  }

  return { id, status: resultOf(attempts), attempts, workerIndex, ...(impact && { impact }) }
}

/** What a passing attempt touched: the app's pages, and the calls and webhooks behind them. */
function attemptImpact(result: AttemptResult, mark: EvidenceMark): TestImpact {
  const { env, loaded } = benchOrFail()

  return impactOf({
    appLog: result.flight.session.appLog(),
    exchanges: (env?.proxy?.exchanges() ?? []).slice(mark.exchanges),
    deliveries: deliveriesOf(env?.webhooks).slice(mark.deliveries),
    baseUrl: env?.baseUrl ?? loaded.config.baseUrl,
  })
}

async function runSuiteHooks(declarations: FileDeclarations, kind: "beforeAll" | "afterAll") {
  for (const hook of suiteHooks(declarations, kind)) await hook.fn(SUITE_FIXTURES)
}

/**
 * Puts the environment where a file starts: back to the seeded state unless every test of the
 * file shares state (`none`), then the file's `beforeAll` hooks, kept as the point its isolated
 * tests start from. Resolves to whether each test is restored before it runs.
 */
async function startFile(
  declarations: FileDeclarations,
  tests: readonly DeclaredTest[],
): Promise<(test: DeclaredTest) => boolean> {
  const { loaded, start } = benchOrFail()
  const fallback: Isolation = loaded.config.isolation ?? "test"
  const modeOf = (test: DeclaredTest) => isolationOf(declarations, test, fallback)
  const setup = suiteHooks(declarations, "beforeAll").length > 0

  if (start !== undefined && tests.some((test) => modeOf(test) !== "none")) {
    await start.clean()
    untouched = true
  }

  await runSuiteHooks(declarations, "beforeAll")
  if (!setup) return (test) => modeOf(test) === "test"

  untouched = false
  if (start?.keeps !== true) return () => false

  // The tests start from what the file's setup left, so it is kept for every later restore.
  if (tests.some((test) => modeOf(test) === "test")) {
    await start.keep("file")
    untouched = true
  }

  return (test) => modeOf(test) === "test"
}

async function testFile(task: TestFileTask): Promise<TestReport[]> {
  const { loaded, workerIndex } = benchOrFail()
  const declarations = await loadTestFile(task.file)
  const selected = new Set(task.testIds)
  const reports: TestReport[] = []
  const chosen = declarations.tests.filter(
    (test) => selected.has(testIdOf(loaded.root, task.file, test)) && test.mode !== "skip",
  )
  const isolated = await startFile(declarations, chosen)

  for (const test of declarations.tests) {
    const id = testIdOf(loaded.root, task.file, test)

    if (!selected.has(id)) continue

    const report =
      test.mode === "skip"
        ? { id, status: "skipped" as const, attempts: [], workerIndex }
        : await runTest(task, declarations, id, isolated(test))

    sendNote({ topic: "tested", data: report })
    reports.push(report)
  }

  await runSuiteHooks(declarations, "afterAll")

  return reports
}

type TrialEnvironment = WorkerEnvironment & { readonly proxy: Proxy }

function hasProxy(env: WorkerEnvironment | undefined): env is TrialEnvironment {
  return env?.proxy !== undefined
}

/** The environment a trial needs: one with a proxy, since faults are injected there. */
function trialEnvironment(): TrialEnvironment {
  const { env } = benchOrFail()

  if (!hasProxy(env)) throw new Error("danwo matrix needs an environment with a proxy")

  return env
}

/** What the trial's notes start with: where its body stopped or its replay diverged. */
function stopNote(result: AttemptResult): string | undefined {
  if (result.stopped !== undefined) return result.stopped

  const divergence = result.divergence

  return (
    divergence &&
    `diverged at step ${divergence.step} (${divergence.instruction}): ${divergence.reason}`
  )
}

/** A trial's verdict: how it ended, why, what kind of failure, and what it spent. */
function verdictOf(result: AttemptResult) {
  const passed = result.status === "passed"

  return {
    status: passed ? ("passed" as const) : ("failed" as const),
    error: result.error?.message ?? null,
    source: result.error?.source,
    errorClass: passed ? undefined : result.error?.class,
    usage: usageOf(result.flight.session.steps()),
  }
}

/**
 * What a trial reports once the app's background work settled: its verdict, and the calls and
 * deliveries from its mark on. Those the environment made
 * while resetting (an app starting up) happen before a fault is armed, so they are not the
 * test's to plan faults on.
 */
function trialReport(
  result: AttemptResult,
  env: TrialEnvironment,
  mark: EvidenceMark,
): TrialReport {
  const stop = stopNote(result)

  return {
    ...verdictOf(result),
    // Bodies stay in the worker: the flight record has them; the run plans by route alone.
    exchanges: env.proxy
      .exchanges()
      .slice(mark.exchanges)
      .map(({ request: _q, response: _r, ...call }) => call),
    deliveries: deliveriesOf(env.webhooks).slice(mark.deliveries),
    ...(env.data !== undefined && { dataCalls: dataCallsOf(env.data, mark.data) }),
    divergence: result.divergence,
    notes: [...(stop === undefined ? [] : [stop]), ...(env.notes?.() ?? [])],
  }
}

/** A trial's record is kept when it failed, and when its fault never fired (it shows why). */
function trialNeedsRecord(report: TrialReport, fault: TrialTask["fault"]): boolean {
  const outcome: RunOutcome = { ...report, fault, error: null }

  return report.status !== "passed" || !faultFired(outcome)
}

/** A clean trial that passed reports how long its checks took, to pace the faulted trials. */
function cleanPace(task: TrialTask, result: AttemptResult): Pick<TrialReport, "pace"> {
  if (task.fault !== null || result.status !== "passed") return {}

  return { pace: paceOf(result.flight.session.steps()) }
}

/** What a trial's race reports: the clean trial's evidence, or whether a race fired and its notes. */
type RaceFacts = Pick<TrialReport, "races" | "fired"> & { readonly notes: readonly string[] }

/** One trial attempt with what its race reported. */
interface TrialRun {
  readonly result: AttemptResult
  readonly recordDir: string | undefined
  readonly mark: EvidenceMark
  readonly race: RaceFacts | undefined
}

/** How one of several users' attempts ended, for the trial's notes. */
function userOutcome(settled: PromiseSettledResult<{ result: AttemptResult }>): string {
  if (settled.status === "rejected") return `could not run: ${String(settled.reason)}`

  const { result } = settled.value

  return result.status === "passed"
    ? "passed"
    : `${result.status}: ${result.error?.message.split("\n")[0] ?? ""}`
}

/**
 * A trial run by `users` people at once, each in a browser of their own against the same app. The
 * first judges the invariant once everyone's body is done; the others run their body alone.
 */
async function withOtherUsers(
  task: TrialTask,
  declarations: FileDeclarations,
  replay: ReplayUse,
  users: number,
): Promise<TrialRun> {
  const label = task.fault?.label ?? "clean"
  const others = Array.from({ length: users - 1 }, () =>
    attemptOnce(declarations, task.file, task.testId, replay, label, task.pace, {
      skipInvariant: true,
      unrecorded: true,
    }),
  )
  const othersDone = Promise.allSettled(others)
  const first = await attemptOnce(declarations, task.file, task.testId, replay, label, task.pace, {
    beforeInvariant: async () => {
      await othersDone
    },
  })
  const settled = await othersDone
  const notes = settled.map((outcome, at) => `user ${at + 2}: ${userOutcome(outcome)}`)

  return {
    ...first,
    race: { fired: settled.every((outcome) => outcome.status === "fulfilled"), notes },
  }
}

/** The trial's attempt: its race set up in the browser, or run by several users at once. */
async function trialRun(
  task: TrialTask,
  env: TrialEnvironment,
  declarations: FileDeclarations,
  replay: ReplayUse,
): Promise<TrialRun> {
  const { fault } = task

  if (fault?.target === "users") return withOtherUsers(task, declarations, replay, fault.users)

  const baseUrl = env.baseUrl ?? benchOrFail().loaded.config.baseUrl
  const race = trialRace(fault, baseUrl, env)
  const extras = race === undefined ? {} : { onContext: race.onContext }
  const label = fault?.label ?? "clean"
  const run = await attemptOnce(
    declarations,
    task.file,
    task.testId,
    replay,
    label,
    task.pace,
    extras,
  )

  return { ...run, race: race?.report() }
}

/** A report's race fields, and its notes followed by the race's. */
function withRace(report: TrialReport, race: RaceFacts | undefined): TrialReport {
  if (race === undefined) return report

  const { notes, ...facts } = race

  return { ...report, ...facts, notes: [...report.notes, ...notes] }
}

/** Runs the trial's attempt in the reset, faulted environment and reports it. */
async function runTrial(
  task: TrialTask,
  env: TrialEnvironment,
  timings: Record<TrialPhase, number>,
): Promise<TrialReport> {
  const replay: ReplayUse = {
    kind: task.fault === null ? "learn" : "replay-only",
    dir: task.cacheDir,
  }
  const declarations = await loadTestFile(task.file)
  const { result, recordDir, mark, race } = await trialRun(task, env, declarations, replay)

  for (const phase of TRIAL_PHASES) timings[phase] += result.timings[phase]
  await timed(timings, "settle", async () => {
    await env.settle?.()
    await env.proxy.settled().catch(() => undefined)
  })

  const reported = withRace(trialReport(result, env, mark), race)
  const verdict = { ...reported, timings, ...cleanPace(task, result) }
  const input: RecordInput = {
    test: task.testId,
    run: { kind: "matrix", fault: task.fault },
    status: verdict.status,
    error: result.error,
    stopped: result.stopped,
    divergence: result.divergence,
    notes: [...verdict.notes, ...result.notes],
    durationMs: result.durationMs,
    flight: result.flight,
    env,
    mark,
    /* A trial that passed keeps no video, even when its record is kept to show a fault never fired. */
    video: videoKept(verdict.status === "passed"),
  }
  const inspected = inspect(input)
  const report = { ...verdict, ...lintOf(inspected) }
  const record = await timed(timings, "close", () =>
    keepRecord(recordDir, trialNeedsRecord(report, task.fault), () =>
      buildRecord(input, inspected),
    ),
  )

  return record === undefined ? report : { ...report, record }
}

/**
 * Puts the environment where every trial starts. The worker's first trial resets it and, when
 * the environment can, keeps a snapshot; every later trial restores that snapshot instead of
 * resetting, which skips app restarts and reseeding.
 */
async function trial(task: TrialTask): Promise<TrialReport> {
  const env = trialEnvironment()
  const timings = noTimings()

  await timed(timings, "prepare", async () => benchOrFail().start?.clean())
  untouched = false
  // The app was reset with it: sign-ins saved before belong to the app as it was.
  benchOrFail().sessions.invalidate()
  applyFault(env, task.fault)

  try {
    return await runTrial(task, env, timings)
  } finally {
    env.proxy.setFault(undefined)
    clearWebhookFaults(env.webhooks)
    clearDataFaults(env.data)
  }
}

/** The lint settings a run uses: the flag wins, then the config; on by default. */
function lintSettings(
  config: LintConfig | false | undefined,
  flag: boolean | undefined,
): LintConfig | undefined {
  if (flag === false) return undefined
  if (config === false) return flag === true ? {} : undefined

  return config ?? {}
}

const calls: WorkerCalls = {
  async start(start: WorkerStart) {
    const loaded = await loadConfig(start.cwd, start.configPath)
    const env = await loaded.config.environment?.({ workerIndex: start.workerIndex })
    const recording = start.record?.mode === "off" ? undefined : start.record
    const sessions = new SessionKeeper(async () => {
      if (keepSignIns) await bench?.start?.keep("session")
    })

    bench = {
      loaded,
      env,
      workerIndex: start.workerIndex,
      recording,
      updateScreenshots: start.updateScreenshots,
      sessions,
      lint: lintSettings(loaded.config.lint, start.lint),
      start: env && new StartingPoint(env, () => sessions.invalidate()),
    }
  },
  testFile,
  trial,
  async stop() {
    stopping ??= closeAndExit()

    return stopping
  },
}

let stopping: Promise<void> | undefined

/** Closes the browser and the environment, then ends the worker. */
async function closeAndExit(): Promise<void> {
  await (await browser?.catch(() => undefined))?.close()
  await bench?.env?.close()
  if (process.connected) process.disconnect()
  process.exit(0)
}

answerCalls(calls)
/* The run is gone (it ended or was killed): close what this worker started rather than outlive it. */
process.once("disconnect", () => void calls.stop())
