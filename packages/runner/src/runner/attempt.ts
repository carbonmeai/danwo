/**
 * One attempt of one test, inside a worker: a browser session through the worker's environment,
 * the test's fixtures, its hooks and body under the test's deadline, then its invariant, then
 * teardown. The attempt's verdict is decided by the first failure in that order, except in a
 * replay-only trial: there a body that broke stops where it broke and the invariant alone judges.
 */
import type { SessionFlight } from "../flight.ts"
import type { FailureEvidence } from "../record/index.ts"
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
import { backendOf } from "./backend.ts"
import type { DanwoConfig } from "./config.ts"
import type { WorkerEnvironment } from "./environment.ts"
import {
  type SessionContext,
  SessionKeeper,
  type StartingState,
  startingState,
} from "./sessions.ts"

/**
 * How an attempt uses the replay cache: `learn` replays what it can and records new steps;
 * `replay-only` never calls the model and stops at the first step that no longer replays.
 */
export type ReplayUse =
  | { readonly kind: "none" }
  | { readonly kind: "learn"; readonly dir: string }
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
  /** Where the test's `toHaveScreenshot` baselines live, and whether to rewrite them. */
  readonly screenshots?: { readonly dir: string; readonly update: "missing" | "all" }
  /** The worker's saved sessions; without it, a test's session is set up afresh every attempt. */
  readonly sessions?: SessionKeeper
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
  const deadline = test.options.timeout ?? setup.config.timeout ?? DEFAULT_TIMEOUT_MS
  const { session, start } = await openStarted(file, test, setup, deadline)
  const fixtures = fixtureScope(test.fixtures, builtInFixtures(session, setup.env))
  const call = (fn: StoredBody) => async () => fn(fixtures.values)

  const body = await stage(
    async () => {
      if (start?.error !== undefined) throw start.error
      await fixtures.prepare(wantedByAll(everyUser(file, test)))
      for (const hook of hooksAround(file, test, "beforeEach")) await call(hook.fn)()
      await call(test.body)()
    },
    deadline,
    "body",
  )
  const judged = await judge(body, test, { session, setup, deadline, run: call })
  let verdict = judged.verdict

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

  return {
    status: verdict.status,
    error: reportedError(verdict, setup.root),
    durationMs: Date.now() - started,
    divergence,
    stopped: judged.stopped,
    flight: { session: session.flight, failure, startedAt: new Date(started).toISOString() },
    notes: start === undefined ? [] : [start.note],
  }
}

/** How a test's saved session is looked up, set up and checked, from inside its attempt. */
function sessionContext(
  file: FileDeclarations,
  setup: AttemptSetup,
  deadline: number,
): SessionContext {
  const { screenshots: _baselines, ...plain } = setup

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
  const replayOnly = judging.setup.replay.kind === "replay-only"

  if (invariant === undefined || body.status === "skipped" || (broke(body) && !replayOnly)) {
    return { verdict: body, stopped: undefined }
  }

  const stopped = broke(body) ? whereItBroke(body, judging) : undefined

  await judging.setup.env?.settle?.()

  return { verdict: await stage(judging.run(invariant), judging.deadline, "invariant"), stopped }
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
  }
}

/** Files to upload and relocation, as the session takes them. */
function pageOptions(config: DanwoConfig): Partial<WebSessionOptions> {
  return {
    ...(config.files !== undefined && { files: config.files }),
    ...(config.relocate !== undefined && { relocate: config.relocate }),
    ...(config.relocation !== undefined && { relocation: config.relocation }),
    ...(config.appErrors !== undefined && { appErrors: config.appErrors }),
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
  }
}

/** The replay cache as the attempt uses it, keyed by the test's id. */
function replayOptions(setup: AttemptSetup): Partial<WebSessionOptions> {
  const { replay } = setup

  if (replay.kind === "none") return {}

  const cache = { dir: replay.dir, mode: "read-write" as const, journey: setup.id }

  return replay.kind === "replay-only" ? { cache, replay: { mode: "strict-stop" } } : { cache }
}

/** Where the flight recorder keeps the attempt's screenshots, one after every step. */
function recordOptions(recordDir: string | undefined): Partial<WebSessionOptions> {
  return recordDir === undefined
    ? {}
    : { artifactsDir: recordDir, record: { stepScreenshots: true } }
}

function openSession(
  setup: AttemptSetup,
  timeout: number,
  state?: BrowserState,
): Promise<WebSession> {
  const { config, env } = setup
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
    ...recordOptions(setup.recordDir),
    ...(setup.screenshots && { screenshots: setup.screenshots }),
    ...(state && { browserState: state }),
    projectRoot: setup.root,
    timeout,
  })
}

/** What every test receives: the session's handles, then whatever the environment adds. */
function builtInFixtures(session: WebSession, env: WorkerEnvironment | undefined) {
  return {
    agent: session.agent,
    screen: session.screen,
    app: session.app,
    expect: session.expect,
    secret: (name: string) => session.secret(name),
    mail: session.mail,
    platform: "web" as const,
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
