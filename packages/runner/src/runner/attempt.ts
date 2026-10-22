/**
 * One attempt of one test, inside a worker: a browser session through the worker's environment,
 * the test's fixtures, its hooks and body under the test's deadline, then its invariant, then
 * teardown. The attempt's verdict is decided by the first failure in that order, except in a
 * replay-only trial: there a body that broke stops where it broke and the invariant alone judges.
 */
import type { Browser, BrowserContext } from "playwright-core"

import type { CheckPace } from "../assert/pace.ts"
import { openDeviceSession } from "../device/session.ts"
import type { DevicePlatform, DeviceTarget } from "../device/types.ts"
import type { SessionFlight } from "../flight.ts"
import type { FailureEvidence, StepRecord } from "../record/index.ts"
import { videoCursorOf } from "../record/video.ts"
import {
  type BrowserState,
  openWebSession,
  type ReplayDivergence,
  type WebSession,
  type WebSessionOptions,
} from "../session.ts"
import { DanwoError } from "../support/codes.ts"
import { DeadlineExceeded, withDeadline } from "../support/deadline.ts"
import { type TestError, testFileLine, toTestError } from "../support/errors.ts"
import { fixtureScope, wantedByAll } from "../tests/fixtures.ts"
import {
  type DeclaredTest,
  type FileDeclarations,
  hooksAround,
  sessionOf,
} from "../tests/registry.ts"
import type { AttemptStatus } from "../tests/retry.ts"
import { isSkipSignal } from "../tests/skip.ts"
import type { StoredBody } from "../tests/types.ts"
import { timeMachineOf } from "../time/index.ts"
import { backendOf } from "./backend.ts"
import type { DanwoConfig } from "./config.ts"
import type { WorkerEnvironment } from "./environment.ts"
import { createRedactor } from "./redact.ts"
import {
  type SessionContext,
  SessionKeeper,
  type StartingState,
  startingState,
} from "./sessions.ts"
import { noTimings, type TrialPhase, timed } from "./timings.ts"
import { usersFixture } from "./users.ts"

/**
 * How an attempt uses the replay cache: `learn` replays what it can and records new steps;
 * `replay-only` never calls the model and stops at the first step that no longer replays. A
 * `readOnly` learner replays and may call the model, but writes nothing back (CI runs). A
 * `replayOnly` learner writes nothing either and calls no model: a step it cannot replay fails
 * (`danwo test --replay-only`).
 */
export type ReplayUse =
  | { readonly kind: "none" }
  | {
      readonly kind: "learn"
      readonly dir: string
      readonly readOnly?: boolean
      readonly replayOnly?: boolean
    }
  | { readonly kind: "replay-only"; readonly dir: string }

export interface AttemptSetup {
  /** The test's id; also names its recordings in the cache. */
  readonly id: string
  readonly config: DanwoConfig
  readonly root: string
  readonly env: WorkerEnvironment | undefined
  readonly replay: ReplayUse
  /** The flight recorder's directory for this attempt; undefined records nothing. */
  readonly recordDir: string | undefined
  /** Film the attempt into its record directory (the browser's tabs, or the device's screen). */
  readonly recordVideo?: boolean
  /** Where the test's `toHaveScreenshot` baselines live, and whether to rewrite them. */
  readonly screenshots?: { readonly dir: string; readonly update: "missing" | "all" }
  /** The worker's saved sessions; without it, a test's session is set up afresh every attempt. */
  readonly sessions?: SessionKeeper
  /** Check timings of a passing run of the same steps, to bound how long each check waits. */
  readonly checkPace?: CheckPace
  /** The worker's browser, kept open across attempts; each attempt gets a fresh context in it. */
  readonly browser?: () => Promise<Browser>
  /** Called with the test's browser context before its first page, e.g. to set up a race. */
  readonly onContext?: (context: BrowserContext) => Promise<void>
  /** Awaited before the invariant runs: a trial with several users waits for the others here. */
  readonly beforeInvariant?: () => Promise<void>
  /** Runs the body alone: another attempt of the same trial judges the invariant. */
  readonly skipInvariant?: boolean
  /** Hears every step as it starts and as it ends, for the run's live feed. */
  readonly onStep?: (step: StepRecord) => void
  /**
   * Called once the test's setup is done (its session, fixtures and `beforeEach` hooks) and just
   * before its body starts: where a matrix trial arms its fault and marks what was setup.
   */
  readonly onBodyStart?: () => void
}

/** What the session saw, for the flight recorder; it stays in the worker. */
export interface AttemptFlight {
  readonly session: SessionFlight
  /** The screen when the attempt failed; undefined when it passed or nothing could be captured. */
  readonly failure: FailureEvidence | undefined
  readonly startedAt: string
}

export interface AttemptResult {
  readonly status: AttemptStatus
  readonly error: TestError | undefined
  readonly durationMs: number
  readonly divergence: ReplayDivergence | undefined
  /** A replay-only trial with an invariant: where the body broke before the invariant judged. */
  readonly stopped: string | undefined
  readonly flight: AttemptFlight
  /** For the flight record: how the test's saved session was had (reused, created, renewed). */
  readonly notes: readonly string[]
  /** Milliseconds in each phase the attempt runs; `prepare` and `settle` are the worker's. */
  readonly timings: Readonly<Record<TrialPhase, number>>
}

const DEFAULT_TIMEOUT_MS = 60_000

/** Where a failure came from; an invariant's failure is reported as such. */
type Phase = "body" | "invariant"

/** How a stage of the attempt ended. */
interface Verdict {
  readonly status: AttemptStatus
  readonly cause?: unknown
  readonly phase: Phase
}

const PASSED: Verdict = { status: "passed", phase: "body" }

/** `current`, unless it passed and `next` holds a failure: the first failure decides. */
function firstFailure(current: Verdict, next: Verdict): Verdict {
  return current.status === "passed" && next.status !== "passed" ? next : current
}

const broke = (verdict: Verdict) => verdict.status === "failed" || verdict.status === "timed-out"

/** Runs `work` under the attempt's deadline and says how it ended. */
async function stage(work: () => Promise<unknown>, ms: number, phase: Phase): Promise<Verdict> {
  try {
    await withDeadline(work, ms, "test")

    return { status: "passed", phase }
  } catch (cause) {
    if (isSkipSignal(cause)) return { status: "skipped", cause, phase }

    return { status: cause instanceof DeadlineExceeded ? "timed-out" : "failed", cause, phase }
  }
}

/** Runs every one of `fns`; returns the first error, after all ran. */
async function runAll(fns: readonly (() => Promise<unknown>)[]): Promise<Verdict> {
  let verdict = PASSED

  for (const fn of fns) {
    try {
      await fn()
    } catch (cause) {
      verdict = firstFailure(verdict, { status: "failed", cause, phase: "body" })
    }
  }

  return verdict
}

/** Runs one attempt of `test` from `file`'s declarations. */
export async function runAttempt(
  file: FileDeclarations,
  test: DeclaredTest,
  setup: AttemptSetup,
): Promise<AttemptResult> {
  const started = Date.now()
  const timings = noTimings()
  const deadline = test.options.timeout ?? setup.config.timeout ?? DEFAULT_TIMEOUT_MS
  const { session, start } = await timed(timings, "open", () =>
    openStarted(file, test, setup, deadline),
  )
  const fixtures = fixtureScope(
    test.fixtures,
    builtInFixtures(session, setup.env, sessionContext(file, setup, deadline)),
  )
  const call = (fn: StoredBody) => async () => fn(fixtures.values)

  const body = await timed(timings, "body", () =>
    stage(
      async () => {
        if (start?.error !== undefined) throw start.error
        session.flight.enter?.("setup")
        await fixtures.prepare(wantedByAll(everyUser(file, test)))
        for (const hook of hooksAround(file, test, "beforeEach")) await call(hook.fn)()
        setup.onBodyStart?.()
        session.flight.enter?.("body")
        await call(test.body)()
      },
      deadline,
      "body",
    ),
  )
  const judged = await timed(timings, "invariant", () =>
    judge(body, test, { session, setup, deadline, run: call }),
  )
  const ended = await timed(timings, "close", () =>
    endAttempt(file, test, { session, setup, fixtures, verdict: judged.verdict, call }),
  )
  /*
   * The error and where the body stopped reach the terminal, the results file, JUnit, the run
   * history and the pull request comment, not only the record: redacted here, with every secret
   * the session knows by its end.
   */
  const redactor = createRedactor((text) => session.flight.redact(text))

  return {
    status: ended.verdict.status,
    error: redactor.deep(reportedError(ended.verdict, setup.root)),
    durationMs: Date.now() - started,
    divergence: redactor.deep(ended.divergence),
    stopped: redactor.deep(judged.stopped),
    flight: {
      session: session.flight,
      failure: ended.failure,
      startedAt: new Date(started).toISOString(),
    },
    notes: start === undefined ? [] : [start.note],
    timings,
  }
}

/** What an attempt's end works on: its session, fixtures and verdict so far. */
interface Ending {
  readonly session: WebSession
  readonly setup: AttemptSetup
  readonly fixtures: ReturnType<typeof fixtureScope>
  readonly verdict: Verdict
  readonly call: (fn: StoredBody) => () => Promise<unknown>
}

/** `afterEach` hooks, fixture teardown, the screen at failure, then the session closed. */
async function endAttempt(file: FileDeclarations, test: DeclaredTest, ending: Ending) {
  const { session, setup, fixtures, call } = ending
  let { verdict } = ending

  session.flight.enter?.("teardown")

  if (verdict.status !== "timed-out") {
    const afterEach = hooksAround(file, test, "afterEach").map((hook) => call(hook.fn))

    verdict = firstFailure(verdict, await runAll(afterEach))
  }

  for (const cause of await fixtures.tearDown()) {
    verdict = firstFailure(verdict, { status: "failed", cause, phase: "body" })
  }

  const failure =
    broke(verdict) && setup.recordDir !== undefined
      ? await session.flight.captureFailure(verdict.cause)
      : undefined
  const divergence = session.divergence()

  await session.close()

  return { verdict, failure, divergence }
}

/** How a test's saved session is looked up, set up and checked, from inside its attempt. */
function sessionContext(
  file: FileDeclarations,
  setup: AttemptSetup,
  deadline: number,
): SessionContext {
  // A saved session's own setup is no part of the test's race, so its browser is left unrouted.
  const { screenshots: _baselines, onContext: _race, ...plain } = setup

  return {
    keeper: setup.sessions ?? new SessionKeeper(),
    definition: (name) => file.sessions.get(name) ?? setup.config.sessions?.[name],
    // A session's own steps replay under its name and are not part of any test's record.
    open: (journey) => openSession({ ...plain, id: journey, recordDir: undefined }, deadline),
    call: async (fn, web) => fn(builtInFixtures(web, setup.env)),
    deadline,
  }
}

/**
 * Opens the test's browser, in its saved session's state when it names one. A kept state whose
 * check fails is set up afresh and the browser opened again from the new state.
 */
async function openStarted(
  file: FileDeclarations,
  test: DeclaredTest,
  setup: AttemptSetup,
  deadline: number,
): Promise<{ session: WebSession; start: StartingState | undefined }> {
  const name = sessionOf(file, test)

  if (name === undefined) return { session: await openSession(setup, deadline), start: undefined }

  const context = sessionContext(file, setup, deadline)
  const start = await startingState(name, context)
  const session = await openSession(setup, deadline, start.state)
  const { check } = start

  if (!start.reused || check === undefined) return { session, start }

  session.flight.enter?.("setup")
  const checked = await stage(() => context.call(check, session), deadline, "body")

  if (checked.status === "passed") return { session, start }

  await session.close()

  const renewed = await startingState(name, context, true)

  return { session: await openSession(setup, deadline, renewed.state), start: renewed }
}

interface Judging {
  readonly session: WebSession
  readonly setup: AttemptSetup
  readonly deadline: number
  readonly run: (fn: StoredBody) => () => Promise<unknown>
}

/**
 * The test's invariant, if it has one, after its body. Normally the body has to pass first. In a
 * replay-only trial the body may break (a fault can take the app another way), so where it broke
 * is noted and the invariant, run once background work settled, decides.
 */
async function judge(
  body: Verdict,
  test: DeclaredTest,
  judging: Judging,
): Promise<{ verdict: Verdict; stopped: string | undefined }> {
  const { invariant } = test
  const { setup } = judging
  const replayOnly = setup.replay.kind === "replay-only"
  const unjudged = invariant === undefined || setup.skipInvariant === true

  if (unjudged || body.status === "skipped" || (broke(body) && !replayOnly)) {
    return { verdict: body, stopped: undefined }
  }

  const stopped = broke(body) ? whereItBroke(body, judging) : undefined

  await setup.beforeInvariant?.()
  await settled(judging.session, setup.env)
  judging.session.flight.enter?.("checks")

  return { verdict: await stage(judging.run(invariant), judging.deadline, "invariant"), stopped }
}

/**
 * Lets the environment's background work finish before the invariant reads it, as a `settle`
 * step of the record that says what was waited for.
 */
async function settled(session: WebSession, env: WorkerEnvironment | undefined): Promise<void> {
  if (env?.settle === undefined) return

  const wait = async () => (await env.settle?.()) ?? []

  session.flight.enter?.("settle")
  if (session.flight.waiting === undefined) await wait()
  else await session.flight.waiting(wait)
}

/** The body's breaking point: the step whose replay diverged, else the line it threw at. */
function whereItBroke(body: Verdict, judging: Judging): string {
  const divergence = judging.session.divergence()

  if (divergence !== undefined) {
    return `body stopped: diverged at step ${divergence.step} (${divergence.instruction}): ${divergence.reason}`
  }

  const line = testFileLine(body.cause, judging.setup.root)
  const message = reportedError(body, judging.setup.root)?.message.split("\n")[0] ?? "failed"

  return `body stopped${line ? ` at ${line.file}:${line.line}` : ""}: ${message}`
}

/** Every function of the attempt that receives fixtures: they decide which ones are set up. */
function everyUser(file: FileDeclarations, test: DeclaredTest) {
  return [
    test.body,
    ...(test.invariant ? [test.invariant] : []),
    ...hooksAround(file, test, "beforeEach").map((hook) => hook.fn),
    ...hooksAround(file, test, "afterEach").map((hook) => hook.fn),
  ]
}

/** The config's model, judge and secrets, as the session takes them. */
function agentOptions(config: DanwoConfig): Partial<WebSessionOptions> {
  return {
    ...(config.model !== undefined && { model: config.model }),
    ...(config.judge !== undefined && { judge: config.judge }),
    ...(config.secrets !== undefined && { secrets: config.secrets }),
    ...(config.budget !== undefined && { budget: config.budget }),
    ...(config.judgeScreenshot !== undefined && { judgeScreenshot: config.judgeScreenshot }),
    ...(config.vision !== undefined && { vision: config.vision }),
  }
}

/** Files to upload and relocation, as the session takes them. */
function pageOptions(config: DanwoConfig): Partial<WebSessionOptions> {
  return {
    ...(config.files !== undefined && { files: config.files }),
    ...(config.relocate !== undefined && { relocate: config.relocate }),
    ...(config.relocation !== undefined && { relocation: config.relocation }),
    ...(config.effects !== undefined && { effects: config.effects }),
    ...(config.appErrors !== undefined && { appErrors: config.appErrors }),
    ...(config.browser?.contextOptions !== undefined && {
      contextOptions: config.browser.contextOptions,
    }),
  }
}

/** What each action waits for, and the environment's backend to wait on. */
function readinessOptions(
  config: DanwoConfig,
  env: WorkerEnvironment | undefined,
): Partial<WebSessionOptions> {
  const setting = config.readiness
  const settle = typeof setting === "object" && setting.settle === true
  const backend = backendOf(env, { settle })

  return {
    ...(setting !== undefined && { readiness: setting }),
    ...(backend && { backend }),
    ...(env?.mail && { mail: env.mail }),
    time: timeMachineOf(env),
  }
}

/** The replay cache as the attempt uses it, keyed by the test's id. */
function replayOptions(setup: AttemptSetup): Partial<WebSessionOptions> {
  const { replay } = setup

  if (replay.kind === "none") return {}

  if (replay.kind === "replay-only")
    return {
      cache: { dir: replay.dir, mode: "read-write", journey: setup.id },
      replay: { mode: "strict-stop" },
    }

  const writes = replay.readOnly !== true && replay.replayOnly !== true
  const cache = {
    dir: replay.dir,
    mode: writes ? "read-write" : "read-only",
    journey: setup.id,
  } as const

  return replay.replayOnly === true ? { cache, replay: { mode: "replay-only" } } : { cache }
}

/** Where the flight recorder keeps the attempt's screenshots, one after every step, and its video. */
function recordOptions(setup: AttemptSetup): Partial<WebSessionOptions> {
  const { recordDir } = setup

  return recordDir === undefined
    ? {}
    : {
        artifactsDir: recordDir,
        record: {
          stepScreenshots: true,
          video: setup.recordVideo === true,
          cursor: videoCursorOf(setup.config.video),
        },
      }
}

/** What this attempt alone brings: its baselines, starting state, check pace and browser. */
async function attemptOptions(
  setup: AttemptSetup,
  state: BrowserState | undefined,
): Promise<Partial<WebSessionOptions>> {
  return {
    ...(setup.screenshots && { screenshots: setup.screenshots }),
    ...(state && { browserState: state }),
    ...(setup.checkPace && { checkPace: setup.checkPace }),
    ...(setup.browser && { browser: await setup.browser() }),
    ...(setup.onContext && { onContext: setup.onContext }),
    ...(setup.onStep && { onStep: setup.onStep }),
  }
}

/** An attempt on the environment's device: its app reset and launched, no browser. */
function openOnDevice(setup: AttemptSetup, device: DeviceTarget, timeout: number) {
  const { config, env } = setup
  const setting = config.readiness
  const backend = backendOf(env, { settle: typeof setting === "object" && setting.settle === true })

  return openDeviceSession(device, {
    baseUrl: env?.baseUrl ?? config.baseUrl,
    projectRoot: setup.root,
    ...(env?.mail && { mail: env.mail }),
    ...(backend && { backend }),
    time: timeMachineOf(env),
    actionTimeout: Math.min(timeout, DEVICE_ACTION_MS),
    ...agentOptions(config),
    ...pageOptions(config),
    ...replayOptions(setup),
    ...deviceAttemptOptions(setup),
  })
}

/** What this device attempt alone brings: its record folder, check pace and baselines. */
function deviceAttemptOptions(setup: AttemptSetup) {
  return {
    ...(setup.recordDir !== undefined && {
      artifactsDir: setup.recordDir,
      stepScreenshots: true,
      video: setup.recordVideo === true,
    }),
    ...(setup.checkPace && { checkPace: setup.checkPace }),
    ...(setup.screenshots && { screenshots: setup.screenshots }),
    ...(setup.onStep && { onStep: setup.onStep }),
  }
}

/** How long one action on a device may wait for its element. */
const DEVICE_ACTION_MS = 15_000

async function openSession(
  setup: AttemptSetup,
  timeout: number,
  state?: BrowserState,
): Promise<WebSession> {
  const { config, env } = setup

  if (env?.device !== undefined) {
    if (state !== undefined) {
      throw new DanwoError("CONFIG_INVALID", "saved sessions are not supported on devices yet")
    }

    return openOnDevice(setup, env.device, timeout)
  }

  const baseUrl = env?.baseUrl ?? config.baseUrl

  if (baseUrl === undefined) {
    throw new DanwoError(
      "CONFIG_INVALID",
      "no baseUrl: set it in danwo.config or return it from environment()",
    )
  }

  return openWebSession({
    baseUrl,
    ...(env?.proxy && { proxy: { url: env.proxy.url, caSpki: env.proxy.caSpki } }),
    ...agentOptions(config),
    ...pageOptions(config),
    ...readinessOptions(config, env),
    ...replayOptions(setup),
    ...recordOptions(setup),
    ...(await attemptOptions(setup, state)),
    projectRoot: setup.root,
    timeout,
  })
}

/**
 * What every test receives: the session's handles, then whatever the environment adds. `sessions`
 * lets `users.open` start another person in a saved session; a session's own setup has none.
 */
function builtInFixtures(
  session: WebSession,
  env: WorkerEnvironment | undefined,
  sessions?: SessionContext,
) {
  const platform: "web" | DevicePlatform =
    "platform" in session && (session.platform === "android" || session.platform === "ios")
      ? session.platform
      : "web"

  return {
    agent: session.agent,
    screen: session.screen,
    app: session.app,
    expect: session.expect,
    secret: (name: string) => session.secret(name),
    mail: session.mail,
    time: session.time,
    users: usersFixture(session, sessions),
    platform,
    ...env?.fixtures,
  }
}

function reportedError(verdict: Verdict, root: string): TestError | undefined {
  if (verdict.cause === undefined || verdict.status === "skipped") return undefined

  const error = toTestError(verdict.cause, root)

  return verdict.phase === "invariant" && verdict.status !== "passed"
    ? { ...error, message: `invariant: ${error.message}` }
    : error
}
