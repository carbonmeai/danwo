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
  type SetupSpan,
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
  sessionOf,
  suiteHooks,
} from "../tests/registry.ts"
import { resultOf, worthRetrying } from "../tests/retry.ts"
import { appsDownNotes, appsDownNow, withAppsDown } from "./apps-down.ts"
import { type AttemptResult, type AttemptSetup, runAttempt, type ReplayUse } from "./attempt.ts"
import { loadTestFile, testIdOf } from "./catalog.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import { writeEnvironmentRecord } from "./environment-record.ts"
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
  Pick<AttemptSetup, "onContext" | "beforeInvariant" | "skipInvariant" | "onBodyStart">
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
): Promise<AttemptRun> {
  const { loaded, env, recording, updateScreenshots, sessions } = benchOrFail()
  const { unrecorded, onBodyStart, ...race } = extras
  const recordDir =
    unrecorded === true ? undefined : recording && attemptDir(recording, id, recordAs)
  const mark = markEvidence(env)
  let body: EvidenceMark | undefined
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
    onBodyStart: () => {
      body = markEvidence(env)
      onBodyStart?.()
    },
  }).finally(() => tap?.stop())

  tap?.end(result.status, result.durationMs)

  return { result, recordDir, mark, body }
}

/** One attempt as it ran: its result, record directory, and the evidence marks at its start and body. */
interface AttemptRun {
  readonly result: AttemptResult
  readonly recordDir: string | undefined
  readonly mark: EvidenceMark
  /** Where the evidence stood when the body began; undefined when setup never finished. */
  readonly body: EvidenceMark | undefined
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

/**
 * Readies the environment for an attempt: restored first when the test is isolated, to the kept
 * sign-in of the session it names when there is one, else to the base without any. A sign-in the
 * attempt makes is kept beside the base only when the attempt began from a starting point.
 */
async function beginAttempt(isolated: boolean, session: string | undefined): Promise<void> {
  const { start } = benchOrFail()

  if (isolated) await start?.again(session)
  keepSignIns = start?.untouched === true
  start?.touch()
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

    await beginAttempt(isolated, sessionOf(declarations, findDeclared(declarations, task.file, id)))

    const { result, recordDir, mark } = await attemptOnce(
      declarations,
      task.file,
      id,
      replay,
      `attempt-${n}`,
    ).finally(() => {
      keepSignIns = false
    })

    attempts.push(await reportAttempt({ id, n, result, recordDir, mark, down: appsDownNow(env) }))

    if (result.status === "passed") impact = attemptImpact(result, mark)
    if (!worthRetrying(result.status)) break
  }

  return { id, status: resultOf(attempts), attempts, workerIndex, ...(impact && { impact }) }
}

/** One finished attempt of a test, with the apps of its environment that are down. */
interface FinishedAttempt {
  readonly id: string
  readonly n: number
  readonly result: AttemptResult
  readonly recordDir: string | undefined
  readonly mark: EvidenceMark
  readonly down: readonly string[]
}

/**
 * An attempt's report, its flight record kept when the run keeps it. Apps of the environment that
 * are down are named in its error and its record's notes.
 */
async function reportAttempt(attempt: FinishedAttempt): Promise<AttemptReport> {
  const { env } = benchOrFail()
  const { result, down } = attempt
  const error = withAppsDown(result.error, down)
  const input: RecordInput = {
    test: attempt.id,
    run: { kind: "test", attempt: attempt.n },
    status: result.status,
    error,
    stopped: result.stopped,
    divergence: result.divergence,
    notes: [...result.notes, ...appsDownNotes(down)],
    durationMs: result.durationMs,
    flight: result.flight,
    env,
    mark: attempt.mark,
    video: videoKept(result.status === "passed"),
  }
  const inspected = inspect(input)
  const record = await keepRecord(attempt.recordDir, result.status !== "passed", () =>
    buildRecord(input, inspected),
  )

  return {
    status: result.status,
    error,
    durationMs: result.durationMs,
    record,
    usage: usageOf(result.flight.session.steps()),
    ...lintOf(inspected),
  }
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

  if (start !== undefined && tests.some((test) => modeOf(test) !== "none")) await start.clean()

  await runSuiteHooks(declarations, "beforeAll")
  if (!setup) return (test) => modeOf(test) === "test"

  start?.touch()
  if (start?.keeps !== true) return () => false

  // The tests start from what the file's setup left, so it is kept for every later restore.
  if (tests.some((test) => modeOf(test) === "test")) await start.keep("file")

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
  marks: { readonly mark: EvidenceMark; readonly body: EvidenceMark | undefined },
): TrialReport {
  const { mark } = marks
  const stop = stopNote(result)

  return {
    setup: setupSpan(env, mark, marks.body ?? markEvidence(env)),
    ...verdictOf(result),
    // Bodies stay in the worker: the flight record has them; the run plans by route alone.
    exchanges: env.proxy
      .exchanges()
      .slice(mark.exchanges)
      .map(({ request: _q, response: _r, ...call }) => call),
    deliveries: deliveriesOf(env.webhooks).slice(mark.deliveries),
    ...(env.data !== undefined && { dataCalls: dataCallsOf(env.data, mark.data) }),
    sockets: env.proxy.sockets().slice(mark.sockets ?? 0),
    divergence: result.divergence,
    notes: [...(stop === undefined ? [] : [stop]), ...(env.notes?.() ?? [])],
  }
}

/**
 * What came between the attempt's start and its body: the setup the matrix plans no faults on.
 * Without a body mark (setup never finished) everything the attempt did was setup.
 */
function setupSpan(env: TrialEnvironment, mark: EvidenceMark, body: EvidenceMark): SetupSpan {
  const data: Record<string, number> = {}

  for (const [at, proxy] of (env.data ?? []).entries())
    data[proxy.service] = (body.data?.[at] ?? 0) - (mark.data?.[at] ?? 0)

  return {
    exchanges: body.exchanges - mark.exchanges,
    deliveries: body.deliveries - mark.deliveries,
    sockets: (body.sockets ?? 0) - (mark.sockets ?? 0),
    data,
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
interface TrialRun extends AttemptRun {
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
  arm: (() => void) | undefined,
): Promise<TrialRun> {
  const { fault } = task

  if (fault?.target === "users") return withOtherUsers(task, declarations, replay, fault.users)

  const baseUrl = env.baseUrl ?? benchOrFail().loaded.config.baseUrl
  const race = trialRace(fault, baseUrl, env)
  const extras = {
    ...(race !== undefined && { onContext: race.onContext }),
    ...(arm !== undefined && { onBodyStart: arm }),
  }
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

/** Runs the trial's attempt, from the test file as loaded, in the reset, faulted environment and reports it. */
async function runTrial(
  task: TrialTask,
  env: TrialEnvironment,
  timings: Record<TrialPhase, number>,
  arm: (() => void) | undefined,
  declarations: FileDeclarations,
): Promise<TrialReport> {
  const replay: ReplayUse = {
    kind: task.fault === null ? "learn" : "replay-only",
    dir: task.cacheDir,
  }
  const { result, recordDir, mark, body, race } = await trialRun(
    task,
    env,
    declarations,
    replay,
    arm,
  )

  for (const phase of TRIAL_PHASES) timings[phase] += result.timings[phase]
  await timed(timings, "settle", async () => {
    await env.settle?.()
    await env.proxy.settled().catch(() => undefined)
  })

  const reported = withRace(trialReport(result, env, { mark, body }), race)
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
  const { start } = benchOrFail()

  /*
   * The plan counts a fault's occurrences from where the trial arms it: the body, unless the
   * plan includes setup. A fault armed at the body leaves setup unfaulted, so a sign-in it makes
   * is kept beside the seeded state and the next trial restores it instead of signing in again.
   * A fault armed before setup may land on the sign-in, so the trial starts from the seeded state
   * without it, and signs in under the fault.
   */
  const atBody = task.includeSetup !== true
  const declarations = await loadTestFile(task.file)
  const session = sessionOf(declarations, findDeclared(declarations, task.file, task.testId))

  await timed(timings, "prepare", async () => start?.clean(atBody ? session : undefined))
  start?.touch()
  keepSignIns = atBody && start?.keeps === true
  if (!atBody) applyFault(env, task.fault)

  try {
    return await runTrial(
      task,
      env,
      timings,
      atBody ? () => applyFault(env, task.fault) : undefined,
      declarations,
    )
  } finally {
    keepSignIns = false
    env.proxy.setFault(undefined)
    clearWebhookFaults(env.webhooks)
    clearDataFaults(env.data)
  }
}

/**
 * A saved session signed in: the environment holds it now, and when the attempt began from a
 * starting point its sign-in is kept beside it. Before it is kept, the app's background work from
 * the sign-in (the webhooks it set off, the calls they make) is let finish, so the kept state is
 * whole and a test or trial that restores it finds nothing of the sign-in still arriving.
 */
async function signedIn(name: string): Promise<void> {
  const start = bench?.start

  start?.signedIn(name)
  if (!keepSignIns || start?.slots !== true) return

  const env = bench?.env

  await env?.settle?.()
  await env?.proxy?.settled().catch(() => undefined)
  await start.keep("session", name)
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

    if (env && recording) await writeEnvironmentRecord(recording.runDir, env, start.workerIndex)
    const sessions = new SessionKeeper({
      signedIn,
      holds: (name) => bench?.start?.holds(name) ?? true,
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
  /* Again at the end: an app's output between tests (a crash during a reset) is only kept here. */
  if (bench?.env && bench.recording)
    await writeEnvironmentRecord(bench.recording.runDir, bench.env, bench.workerIndex)
  await bench?.env?.close()
  if (process.connected) process.disconnect()
  process.exit(0)
}

answerCalls(calls)
/* The run is gone (it ended or was killed): close what this worker started rather than outlive it. */
process.once("disconnect", () => void calls.stop())
