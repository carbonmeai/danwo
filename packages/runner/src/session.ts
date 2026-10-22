import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { taggedUserAgent } from "@danwo/proxy"
import type { LanguageModel } from "ai"
import type { Browser, BrowserContext, Page } from "playwright-core"

import type { Budgets } from "./agent/budget.ts"
import type { Agent, ReplayDivergence } from "./agent/index.ts"
import { recordingExpect } from "./assert/checks.ts"
import { type Expect, expect } from "./assert/index.ts"
import type { CheckPace } from "./assert/pace.ts"
import type { BaselineUpdate } from "./assert/screenshot.ts"
import type { AppErrorOptions } from "./browser/app-errors.ts"
import { type ContextOptions, playwrightOptions } from "./browser/context-options.ts"
import { type App, type BrowserFlags, launchBrowser } from "./browser/index.ts"
import { showPointer } from "./browser/pointer.ts"
import type { Backend, ReadinessMode } from "./browser/readiness.ts"
import { hideSecretText, TabFilm, videoContextOptions } from "./browser/video.ts"
import { createSessionFlight, type SessionFlight } from "./flight.ts"
import {
  type BrowserAgent,
  type EffectsSetting,
  handlesFor,
  type SessionMail,
  type Settings,
  type SharedDesk,
} from "./handles.ts"
import { registerValueEngine, type Screen } from "./locate/index.ts"
import { MailDesk } from "./mail/desk.ts"
import type { MailSource } from "./mail/index.ts"
import { modelName } from "./model/resolve.ts"
import { type StepRecord, StepRecorder } from "./record/index.ts"
import { failureReason } from "./record/missing.ts"
import { type CacheMode, ReplayStore } from "./replay/index.ts"
import { type RelocationPolicy, relocationOf } from "./replay/policy.ts"
import { type Secret, SecretVault, type SessionSecret } from "./secrets/index.ts"
import { registerIconEngine } from "./snapshot/icons.ts"
import { DanwoError } from "./support/codes.ts"
import {
  type SessionTime,
  sessionTime,
  showTime,
  type TimeMachine,
  timeMachineOf,
} from "./time/index.ts"
import type { VisionSetting } from "./vision/desk.ts"

export type { ReplayDivergence } from "./agent/index.ts"
export { type EffectsSetting, effectsOptions, pacer, type SessionMail } from "./handles.ts"

/**
 * What a browser context remembers of the sites it visited: cookies, and each origin's
 * localStorage and IndexedDB. A saved session is one of these, taken after signing in.
 */
export type BrowserState = Awaited<ReturnType<BrowserContext["storageState"]>>
export type { SessionSecret } from "./secrets/index.ts"

/** The app, and how long to wait for it. */
interface AppOptions {
  /** The app's base URL; `app.open(path)` resolves paths against it. */
  readonly baseUrl: string
  /** Default timeout of one action (click, fill), in milliseconds. */
  readonly actionTimeout?: number
  /** Default timeout of one `expect` poll, in milliseconds. */
  readonly assertionTimeout?: number
  /**
   * Check timings from a passing run of the same steps: each check then waits only a few times as
   * long as it took there (`danwo matrix` paces its faulted trials by their clean run).
   */
  readonly checkPace?: CheckPace
  /** Timeout of a page load, in milliseconds. */
  readonly timeout?: number
}

/** What the session waits for after each action before going on (see browser/readiness.ts). */
interface ReadinessSettings {
  /**
   * `page+backend` (the default when `backend` is given): the page settles and nothing the app
   * started at the proxy or the webhook senders is still in flight. `page`: the page alone.
   * `off`: no waiting beyond what each action does itself.
   */
  readonly readiness?: ReadinessMode | { readonly mode?: ReadinessMode; readonly capMs?: number }
  /** How the backend is told quiet, from the environment: its proxy and webhook senders. */
  readonly backend?: Backend
  /**
   * Besides the app's 5xx responses and uncaught page errors, count console errors as the app
   * failing (default false). A live `agent.act` stops at the first failure; see browser/app-errors.ts.
   */
  readonly appErrors?: AppErrorOptions
  /**
   * What moves time behind the app for `time.travel`: the environment's services and the apps'
   * clocks (see time/index.ts). Without it, travelling moves the page's clock alone.
   */
  readonly time?: TimeMachine
}

/** The browser behind the run's proxy. */
interface BrowserOptions {
  /** Route the browser through a danwo proxy and trust its per-run CA. */
  readonly proxy?: { readonly url: string; readonly caSpki: string }
  /** Extra launch options: `args` are added to the proxy's flags; `proxy` replaces the danwo proxy. */
  readonly launch?: BrowserFlags
  readonly headed?: boolean
  /**
   * An open browser to start the session's context in, launched with the same proxy settings; it
   * stays open when the session closes. Without it, the session launches and closes its own.
   */
  readonly browser?: Browser
  /** Start the browser context with this state, e.g. a saved session's cookies and storage. */
  readonly browserState?: BrowserState
  /** Called with the session's browser context before its first page opens, e.g. to route requests. */
  readonly onContext?: (context: BrowserContext) => Promise<void>
  /**
   * Options of every browser context the session opens, its other people's included: motion,
   * colour scheme, locale, time zone, viewport, HTTP credentials and headers.
   */
  readonly contextOptions?: ContextOptions
}

/** Who carries out `agent.act` and judges `agent.assert`. */
interface ModelOptions {
  /**
   * The model `agent.act` runs on: an AI SDK model, or a model id such as
   * `"anthropic/claude-sonnet-5"`, resolved through the Vercel AI Gateway
   * (`AI_GATEWAY_API_KEY`). Without it, `agent` is unavailable.
   */
  readonly model?: LanguageModel
  /** The model `agent.assert` judges with; defaults to `model`. Use another provider so the judge is not the actor. */
  readonly judge?: LanguageModel
  /** Show the judge a screenshot of the page besides its text (default false: text only). */
  readonly judgeScreenshot?: boolean
  /**
   * When the agent may see the page as an image: `auto` (default, unless the model is known to
   * take no images) offers a screenshot with numbered marks when the text view misses something
   * (a canvas, an unnamed button, a frame it cannot list), and the judge sees one then too;
   * `always` shows one with every view; `off` never. `{ mode, model }` names a model of its own
   * for reading screenshots. Actions taken on a screenshot replay by finding their place by how it
   * looks, with no model call.
   */
  readonly vision?: VisionSetting
  /**
   * Limits on what the agent spends, per `agent.act` step and over the whole session: turns, model
   * calls, dollars and wall time. Default 25 turns a step and no other limit. A step that runs out
   * fails with `BUDGET_EXCEEDED`.
   */
  readonly budget?: Budgets
  /** A step's conversation size, in characters, before older page views are dropped (default 60 000). */
  readonly transcriptBudget?: number
  /** Trusted project context added to the agent's prompts. */
  readonly agentContext?: string
  /**
   * Values the model must never see, by name. Pass `session.secret(name)` as an `agent.act` param
   * or to `locator.fill`: the model gets the name, the browser gets the value, and the value is
   * redacted everywhere and never written to the replay cache.
   */
  readonly secrets?: Readonly<Record<string, SessionSecret>>
  /**
   * Files tests may upload, by name: the agent's `upload_file` and `locator.setInputFiles` take
   * these names, never paths. Paths resolve against `projectRoot`.
   */
  readonly files?: Readonly<Record<string, string>>
  /**
   * Where mail the app sends lands, e.g. `[resendMail(emulator)]`: the agent's `read_mail` and
   * `open_mail` and the session's `mail` read from these, and a code typed from mail is recorded
   * by where it came from, so a replay reads the new one.
   */
  readonly mail?: readonly MailSource[]
}

/** Where recorded `agent.act` steps live; a step that replays needs no model call. */
interface CacheOptions {
  readonly dir: string
  readonly mode: CacheMode
  /** Part of every cache key; keeps one app's recordings apart from another's. Default "danwo". */
  readonly projectId?: string
  /** The journey's name; part of every cache key. Default "journey". */
  readonly journey?: string
  /** Stable identity of the app under test; default the base URL's origin. */
  readonly appIdentity?: string
}

/** Recordings to replay, and how strictly. */
interface ReplayOptions {
  readonly cache?: CacheOptions
  /**
   * How `agent.act` treats the replay cache. `strict-stop` replays recordings only and never calls
   * the model: on the first step whose recording no longer replays, that step and every later
   * `agent.act` return without acting, and the session keeps the divergence (`divergence()`). A
   * step with no recording at all fails. For runs whose deterministic checks then judge the state
   * the app was left in, such as fault-matrix runs. `replay-only` also calls no model, and fails
   * each step that has no recording that replays (none, a stale one, or one that no longer
   * matches) with `REPLAY_MISSING`, as a test's own failure. Requires `cache`.
   */
  readonly replay?: { readonly mode: "strict-stop" | "replay-only" }
  /**
   * When a recorded element is no longer where the recording found it (renamed, moved to another
   * part of the page), look for the one element that clearly matches it and carry on, noting the
   * move in the step's record; with a writable cache the recording is updated. Default true.
   * Never under `strict-stop`, which follows its recordings exactly. `false` is the `exact` policy.
   */
  readonly relocate?: boolean
  /**
   * How a replay finds recorded elements, as a versioned policy that is part of every recording's
   * key (see replay/policy.ts): `similar-v1` (default) also finds an element that moved, `exact`
   * never does. Takes precedence over `relocate`.
   */
  readonly relocation?: RelocationPolicy
  /**
   * Whether a replayed step must have the effects its recording had: the same elements appearing
   * and vanishing, the same provider calls and webhooks behind the page (default true). `ignore`
   * leaves text matching a pattern out of page effects, for content that changes on its own.
   */
  readonly effects?: EffectsSetting
}

/** What the flight recorder keeps of the attempt. */
interface RecordOptions {
  /** Where test files live; a step then names the test line it was called from. Default the cwd. */
  readonly projectRoot?: string
  /**
   * Where the attempt's screenshots and screen captures go. Given, it is the caller's and is kept
   * after `close()`; otherwise a temporary directory is used and removed.
   */
  readonly artifactsDir?: string
  /**
   * Take a screenshot after every step (see `flight`), and film every tab into
   * `<artifactsDir>/video` when `video` is set; the film draws a pointer at each action unless
   * `cursor` is false.
   */
  readonly record?: {
    readonly stepScreenshots: boolean
    readonly video?: boolean
    readonly cursor?: boolean
  }
  /** Hears every step as it starts (status `running`) and again as it ends, redacted. */
  readonly onStep?: (step: StepRecord) => void
  /**
   * Baselines of `toHaveScreenshot`: the folder they live in (default `__screenshots__` in the
   * project root) and when to write them: `missing` (default) writes the ones not there yet,
   * `all` rewrites every one, `none` never writes.
   */
  readonly screenshots?: { readonly dir?: string; readonly update?: BaselineUpdate }
}

export type WebSessionOptions = AppOptions &
  ReadinessSettings &
  BrowserOptions &
  ModelOptions &
  ReplayOptions &
  RecordOptions

export interface WebSession {
  readonly screen: Screen
  readonly expect: Expect
  /** Natural-language steps; throws on first use when no `model` was given. */
  readonly agent: Agent
  readonly app: App
  /** The first replay divergence under `replay: { mode: "strict-stop" }`; undefined otherwise. */
  divergence(): ReplayDivergence | undefined
  /** The opaque handle of a secret from `options.secrets`; throws for an unknown name. */
  secret(name: string): Secret
  /** Mail the app sent, from `options.mail`. */
  readonly mail: SessionMail
  /** What the attempt did, for the flight recorder; read `steps()` after `close()` for final records. */
  readonly flight: SessionFlight
  /** The context's cookies, localStorage and IndexedDB now, to start another context from. */
  browserState(): Promise<BrowserState>
  /** Time travel: moves the app, the emulators and the page forward together. */
  readonly time: SessionTime
  /**
   * Opens another person's browser in the same test, e.g. a teammate who should see a change
   * live: a context of its own in the same browser, behind the same proxy, signed out or in
   * `state`. Their steps, calls and video are recorded under `name`; it closes with the session.
   */
  openUser(name: string, options?: { readonly state?: BrowserState }): Promise<UserSession>
  /** Ends the attempt and closes the browser. */
  close(): Promise<void>
}

/**
 * Another person's browser in a test, from `WebSession.openUser`: the same handles a test has for
 * its own browser, working on that person's context.
 */
export interface UserSession {
  /** Who this is, as their steps, calls and video are labelled in the flight record. */
  readonly name: string
  readonly app: App
  readonly screen: Screen
  readonly expect: Expect
  readonly agent: Agent
  /** Mail the app sent, as the test's own `mail` reads it; `mail.open` shows it in this browser. */
  readonly mail: SessionMail
  secret(name: string): Secret
  /** Closes this person's browser now; the session closes any still open when it ends. */
  close(): Promise<void>
}

const DEFAULT_ACTION_MS = 10_000
const DEFAULT_ASSERTION_MS = 10_000
const DEFAULT_LOAD_MS = 60_000

interface Opened {
  readonly browser: Browser
  readonly context: BrowserContext
  readonly page: Page
  /** Films the tabs, when the attempt records video. */
  readonly film: TabFilm | undefined
}

/** A new context for the attempt: its saved state, and video when it records it. */
async function newContext(
  browser: Browser,
  options: WebSessionOptions,
  film: string | undefined,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    ...playwrightOptions(options.contextOptions),
    ...(options.browserState !== undefined && { storageState: options.browserState }),
    ...(film !== undefined && videoContextOptions(film)),
  })

  if (film !== undefined) await filmContext(context, options.record?.cursor !== false)

  return context
}

/** Readies a filmed context: secret fields as dots, and the pointer when `cursor` is on. */
async function filmContext(context: BrowserContext, cursor: boolean): Promise<void> {
  await hideSecretText(context)
  if (cursor) await showPointer(context)
}

/** The browser the attempt opens in: the one given, else one launched for it alone. */
function browserOf(options: WebSessionOptions): Promise<Browser> {
  if (options.browser !== undefined) return Promise.resolve(options.browser)

  return launchBrowser({
    ...(options.proxy && { proxy: options.proxy }),
    ...(options.launch && { flags: options.launch }),
    headless: !(options.headed ?? false),
  })
}

async function openBrowser(
  options: WebSessionOptions,
  artifactsDir: string,
): Promise<Opened & { readonly own: boolean }> {
  await registerValueEngine()
  await registerIconEngine()

  const own = options.browser === undefined
  const browser = await browserOf(options)
  const filming = options.record?.video === true ? artifactsDir : undefined

  try {
    const context = await newContext(browser, options, filming)

    await options.onContext?.(context)

    const page = await context.newPage()
    const film = filming === undefined ? undefined : new TabFilm(filming)

    film?.watch(page)

    return { browser, context, page, own, film }
  } catch (error) {
    if (own) await browser.close()
    throw error
  }
}

function replayStore(options: WebSessionOptions): ReplayStore | undefined {
  const { cache } = options

  if (options.replay && !cache)
    throw new Error("openWebSession: `replay` needs `cache`, the recordings to replay")
  if (cache === undefined) return undefined

  return new ReplayStore({
    dir: cache.dir,
    mode: options.replay ? "read-only" : cache.mode,
    projectId: cache.projectId ?? "danwo",
    journey: cache.journey ?? "journey",
    appIdentity: cache.appIdentity ?? appIdentityOf(options.baseUrl),
    policy: relocationOf(options),
    models: { actor: modelName(options.model), judge: modelName(options.judge) },
  })
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

/**
 * Which app a recording belongs to: its origin, except that an app on this machine is known by
 * scheme and host alone. Test environments start local apps on a free port each run, so the port
 * would make every recording unreachable on the next run.
 */
function appIdentityOf(baseUrl: string): string {
  const url = new URL(baseUrl)

  return LOOPBACK.has(url.hostname) ? `${url.protocol}//${url.hostname}` : url.origin
}

/** How long actions, checks and page loads wait, with defaults filled in. */
function timeoutsOf(options: WebSessionOptions) {
  return {
    actionTimeout: options.actionTimeout ?? DEFAULT_ACTION_MS,
    assertionTimeout: options.assertionTimeout ?? DEFAULT_ASSERTION_MS,
    loadTimeout: options.timeout ?? DEFAULT_LOAD_MS,
  }
}

/** The session's options with their defaults filled in. */
function settingsOf(options: WebSessionOptions): Settings & { readonly stepScreenshots: boolean } {
  const projectRoot = options.projectRoot ?? process.cwd()

  return {
    ...timeoutsOf(options),
    projectRoot,
    files: Object.fromEntries(
      Object.entries(options.files ?? {}).map(([name, path]) => [name, resolve(projectRoot, path)]),
    ),
    stepScreenshots: options.record?.stepScreenshots ?? false,
    strict: options.replay?.mode === "strict-stop",
    replayOnly: options.replay?.mode === "replay-only",
    relocation: relocationOf(options),
  }
}

/** A person's name as it labels their steps, calls and video: letters, digits, `.`, `_` and `-`. */
const USER_NAME = /^[\w.-]{1,40}$/

/** Another person's open browser, kept so the session can close it and keep its film. */
interface OpenUser {
  readonly name: string
  readonly context: BrowserContext
  readonly film: TabFilm | undefined
  readonly agent: BrowserAgent
  closed: boolean
}

/** Closes a person's context, takes it off the clock and saves its film; idempotent. */
async function closeUser(user: OpenUser, contexts: BrowserContext[]): Promise<void> {
  if (user.closed) return
  user.closed = true

  const closedAt = Date.now()
  const at = contexts.indexOf(user.context)

  if (at >= 0) contexts.splice(at, 1)
  await closeFilmed(user.context, user.film, closedAt)
}

/**
 * Closes a context and saves its film. A context that fails to close never finishes its videos,
 * so they are marked lost with why, and the error goes on.
 */
async function closeFilmed(
  context: BrowserContext,
  film: TabFilm | undefined,
  closedAt: number,
): Promise<void> {
  try {
    await context.close()
  } catch (error) {
    film?.lose(
      `the browser did not close, so the video was never finished: ${failureReason(error)}`,
    )
    throw error
  }

  await film?.save(closedAt)
}

/** What opening another person's browser needs from its session. */
interface UserDesk {
  readonly shared: SharedDesk
  readonly browser: Browser
  readonly steps: StepRecorder
  /** The user agent the session's own browser sends, which each person's adds their tag to. */
  readonly userAgent: () => Promise<string>
  readonly users: OpenUser[]
  readonly filming: string | undefined
  /** Whether filmed browsers draw the pointer at each action. */
  readonly cursor: boolean
  /** The options every browser context of the session opens with. */
  readonly contextOptions: ContextOptions | undefined
}

/** Throws unless `name` can label a new person in this session. */
function checkUserName(name: string, users: readonly OpenUser[]): void {
  if (!USER_NAME.test(name)) {
    throw new DanwoError(
      "CONFIG_INVALID",
      `openUser: "${name}" is not a usable name; use letters, digits, ".", "_" or "-"`,
    )
  }

  if (users.some((user) => user.name === name && !user.closed)) {
    throw new DanwoError("CONFIG_INVALID", `openUser: "${name}" already has a browser open`)
  }
}

/** Opens `name`'s browser context in the session's browser, behind the same proxy. */
async function openUserBrowser(
  desk: UserDesk,
  name: string,
  state: BrowserState | undefined,
): Promise<UserSession> {
  checkUserName(name, desk.users)

  const { shared } = desk
  const context = await desk.browser.newContext({
    ...playwrightOptions(desk.contextOptions),
    userAgent: taggedUserAgent(await desk.userAgent(), name),
    ...(state !== undefined && { storageState: state }),
    ...(desk.filming !== undefined && videoContextOptions(desk.filming, name)),
  })

  if (desk.filming !== undefined) await filmContext(context, desk.cursor)
  await shared.options.onContext?.(context)
  await showTime(context, shared.machine)

  const page = await context.newPage()
  const film = desk.filming === undefined ? undefined : new TabFilm(desk.filming, name)

  film?.watch(page)
  shared.contexts.push(context)

  const steps = desk.steps.forUser(name)
  const handles = handlesFor(shared, { context, page, steps, film })
  const open: OpenUser = { name, context, film, agent: handles.agent, closed: false }

  desk.users.push(open)

  return {
    name,
    app: handles.app,
    screen: handles.screen,
    expect: recordingExpect(expect, steps),
    agent: handles.agent,
    mail: handles.mail,
    secret: (secret) => shared.vault.handle(secret),
    close: () => closeUser(open, shared.contexts),
  }
}

/** The user agent `page`'s browser sends, read once. */
function userAgentOf(page: Page): () => Promise<string> {
  let read: Promise<string> | undefined

  return () => {
    read ??= page.evaluate(() => navigator.userAgent)

    return read
  }
}

/**
 * Opens one browser attempt: a fresh browser context behind the proxy, with `screen`, `expect`,
 * `app.open` and the agent all working on its page.
 */
export async function openWebSession(options: WebSessionOptions): Promise<WebSession> {
  const store = replayStore(options)
  const ownsArtifacts = options.artifactsDir === undefined
  const artifactsDir = options.artifactsDir ?? (await mkdtemp(join(tmpdir(), "danwo-attempt-")))
  const { browser, context, page, own, film } = await openBrowser(options, artifactsDir)
  const settings = settingsOf(options)
  const vault = new SecretVault(options.secrets)
  const stopped = new AbortController()
  const users: OpenUser[] = []
  /* The recorder tells the flight about each step that ends; the flight reads the recorder. */
  const ended: { onStep?: (step: StepRecord) => void } = {}
  const steps = new StepRecorder({
    projectRoot: settings.projectRoot,
    redact: vault.redact,
    onStart: (step) => options.onStep?.(step),
    onEnd: (step) => {
      ended.onStep?.(step)
      options.onStep?.(step)
    },
  })
  const machine = options.time ?? timeMachineOf(undefined)
  const shared: SharedDesk = {
    options,
    settings,
    store,
    vault,
    desk: new MailDesk(options.mail ?? []),
    machine,
    signal: stopped.signal,
    artifactsDir,
    contexts: [context],
  }
  const handles = handlesFor(shared, { context, page, steps, film })
  const flight = createSessionFlight({
    page: () => handles.tabs.page,
    vault,
    steps,
    artifactsDir,
    stepScreenshots: settings.stepScreenshots,
    videos: () => [
      ...(film?.videos() ?? []),
      ...users.flatMap((user) => user.film?.videos() ?? []),
    ],
    lostVideos: () => [
      ...(film?.missing() ?? []),
      ...users.flatMap((user) => user.film?.missing() ?? []),
    ],
  })

  ended.onStep = (step) => flight.onStep(step)
  await showTime(context, machine)

  const desk: UserDesk = {
    shared,
    browser,
    steps,
    userAgent: userAgentOf(page),
    users,
    filming: film === undefined ? undefined : artifactsDir,
    cursor: options.record?.cursor !== false,
    contextOptions: options.contextOptions,
  }
  let closed = false

  return {
    screen: handles.screen,
    expect: recordingExpect(expect, steps),
    agent: handles.agent,
    divergence: () =>
      handles.agent.diverged() ?? users.map((user) => user.agent.diverged()).find(Boolean),
    secret: (name) => vault.handle(name),
    mail: handles.mail,
    flight,
    app: handles.app,
    browserState: () => context.storageState({ indexedDB: true }),
    time: sessionTime(
      machine,
      shared.contexts,
      (label, act) => steps.run("app", "time.travel", label, act),
      handles.ready,
      options.contextOptions?.timezoneId,
    ),
    openUser: (name, opened = {}) => openUserBrowser(desk, name, opened.state),
    async close() {
      if (closed) return
      closed = true
      // A recording is written only once a later check confirmed what its step did.
      await store?.settle((step) => steps.verifiedAfter(step))
      steps.settleRecordings((step) => steps.verifiedAfter(step))
      await flight.settle()
      stopped.abort()

      const closedAt = Date.now()

      try {
        for (const user of users) await closeUser(user, shared.contexts)
        await closeFilmed(context, film, closedAt)
      } finally {
        if (own) await browser.close()
        if (ownsArtifacts) await rm(artifactsDir, { recursive: true, force: true })
      }
    },
  }
}
