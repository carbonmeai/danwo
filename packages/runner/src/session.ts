import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { LanguageModel } from "ai"
import type { Browser, BrowserContext, Page } from "playwright-core"

import type { Budgets } from "./agent/budget.ts"
import { type Agent, createAgent, type ReplayDivergence } from "./agent/index.ts"
import { type Expect, expect } from "./assert/index.ts"
import { type CheckPace, checkKey, pacedTimeout } from "./assert/pace.ts"
import type { BaselineUpdate, ScreenshotEvent } from "./assert/screenshot.ts"
import { type AppErrorOptions, AppErrors } from "./browser/app-errors.ts"
import { type App, type BrowserFlags, launchBrowser } from "./browser/index.ts"
import { type Backend, Readiness, type ReadinessMode } from "./browser/readiness.ts"
import { Tabs } from "./browser/tabs.ts"
import { createSessionFlight, type SessionFlight } from "./flight.ts"
import { createScreen, registerValueEngine, type Screen } from "./locate/index.ts"
import { MailDesk } from "./mail/desk.ts"
import type { MailMessage, MailSource } from "./mail/index.ts"
import { recordAppLog, type StepRecord, StepRecorder } from "./record/index.ts"
import { type CacheMode, ReplayStore } from "./replay/index.ts"
import { type RelocationPolicy, relocationOf } from "./replay/policy.ts"
import { type Secret, SecretVault, type SessionSecret } from "./secrets/index.ts"
import { DanwoError } from "./support/codes.ts"
import { type VisionSetting, visionModelOf, visionModeOf } from "./vision/desk.ts"

export type { ReplayDivergence } from "./agent/index.ts"

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

/** The mail the app sent, as a test reads it. */
export interface SessionMail {
  /** The newest email to `to`, if one arrived. */
  latest(to: string): MailMessage | undefined
  /** The code in the newest email to `to`, waiting for the email when it has not arrived yet. */
  code(to: string, options?: { readonly digits?: number }): Promise<string>
  /** A link in the newest email to `to`: the first, or the one whose text or URL has `match`. */
  link(to: string, options?: { readonly match?: string }): Promise<string>
  /** Shows the newest email to `to` in the active tab, to click its links. */
  open(to: string): Promise<void>
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
   * the app was left in, such as fault-matrix runs. Requires `cache`.
   */
  readonly replay?: { readonly mode: "strict-stop" }
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

/** Effects on or off, or on with text to leave out. */
export type EffectsSetting = boolean | { readonly ignore?: readonly (string | RegExp)[] }

/** What the agent takes of the effects setting. */
function effectsOf(setting: EffectsSetting | undefined) {
  if (setting === false) return { enabled: false, ignore: [] }

  const patterns = typeof setting === "object" ? (setting.ignore ?? []) : []

  return {
    enabled: true,
    ignore: patterns.map((pattern) =>
      typeof pattern === "string" ? new RegExp(pattern) : pattern,
    ),
  }
}

/** The agent's effect settings and where it reads the backend's history from. */
function effectsOptions(options: {
  readonly effects?: EffectsSetting
  readonly backend?: Backend
}) {
  const { backend } = options
  const effects = effectsOf(options.effects)

  if (backend?.activity === undefined) return { effects }

  return { effects, activity: () => backend.activity?.() ?? { calls: [], deliveries: [] } }
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
  /** Take a screenshot after every step (see `flight`). */
  readonly record?: { readonly stepScreenshots: boolean }
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
  /** Ends the attempt and closes the browser. */
  close(): Promise<void>
}

const DEFAULT_ACTION_MS = 10_000
const DEFAULT_ASSERTION_MS = 10_000
const DEFAULT_LOAD_MS = 60_000

interface Opened {
  readonly browser: Browser
  readonly context: BrowserContext
  readonly page: Page
}

async function openBrowser(
  options: WebSessionOptions,
): Promise<Opened & { readonly own: boolean }> {
  await registerValueEngine()

  const own = options.browser === undefined
  const browser =
    options.browser ??
    (await launchBrowser({
      ...(options.proxy && { proxy: options.proxy }),
      ...(options.launch && { flags: options.launch }),
      headless: !(options.headed ?? false),
    }))

  try {
    const context = await browser.newContext(
      options.browserState === undefined ? {} : { storageState: options.browserState },
    )
    const page = await context.newPage()

    return { browser, context, page, own }
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
    appIdentity: cache.appIdentity ?? new URL(options.baseUrl).origin,
    policy: relocationOf(options),
  })
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
function settingsOf(options: WebSessionOptions) {
  const projectRoot = options.projectRoot ?? process.cwd()

  return {
    ...timeoutsOf(options),
    projectRoot,
    files: Object.fromEntries(
      Object.entries(options.files ?? {}).map(([name, path]) => [name, resolve(projectRoot, path)]),
    ),
    stepScreenshots: options.record?.stepScreenshots ?? false,
    strict: options.replay?.mode === "strict-stop",
    relocation: relocationOf(options),
  }
}

/** The session's screenshot checks: baselines folder, a counter, and their notes on the step. */
function screenshotDesk(
  options: WebSessionOptions,
  projectRoot: string,
  artifactsDir: string,
  steps: StepRecorder,
) {
  let count = 0

  return {
    settings: {
      dir: resolve(projectRoot, options.screenshots?.dir ?? "__screenshots__"),
      update: options.screenshots?.update ?? "missing",
      artifactsDir,
    },
    next: () => ++count,
    note: (event: ScreenshotEvent) => steps.event(event),
  }
}

/** `app` of a session: the base URL, and opening a path of it on the active tab. */
function appOf(
  tabs: Tabs,
  steps: StepRecorder,
  page: {
    readonly baseUrl: string
    readonly loadTimeout: number
    readonly ready: () => Promise<void>
  },
): App {
  const { baseUrl } = page

  return {
    baseUrl,
    open: (path) =>
      steps.run("app", "app.open", path ?? "/", async () => {
        await tabs.page.goto(new URL(path ?? "/", baseUrl).href, { timeout: page.loadTimeout })
        await page.ready()
      }),
  }
}

/** A value read from mail, or the failure of a test that needed it. */
function need(to: string, what: string, found: string | undefined): string {
  if (found === undefined)
    throw new DanwoError("TEST_FAILED", `no mail to ${to} with ${what} arrived`)

  return found
}

/** `mail` of a session: reading the app's mail, and showing a message in the active tab. */
function mailOf(
  desk: MailDesk,
  tabs: Tabs,
  steps: StepRecorder,
  page: { readonly timeout: number; readonly ready: () => Promise<void> },
): SessionMail {
  return {
    latest: (to) => desk.latest(to),
    code: async (to, options = {}) =>
      need(
        to,
        "a code",
        await desk.value(to, { kind: "code", digits: options.digits }, page.timeout),
      ),
    link: async (to, options = {}) =>
      need(
        to,
        "a link",
        await desk.value(to, { kind: "link", match: options.match }, page.timeout),
      ),
    open: (to) =>
      steps.run("app", "mail.open", to, async () => {
        if (!(await desk.open(tabs.page, to, page.timeout)))
          throw new DanwoError("TEST_FAILED", `no mail to ${to} arrived`)

        await page.ready()
      }),
  }
}

/** The session's readiness, from its settings: `page+backend` by default when a backend is given. */
function readinessOf(options: WebSessionOptions): Readiness {
  const setting = options.readiness
  const fallback: ReadinessMode = options.backend === undefined ? "page" : "page+backend"
  const mode = typeof setting === "string" ? setting : (setting?.mode ?? fallback)
  const capMs = typeof setting === "object" ? setting.capMs : undefined

  return new Readiness({
    mode,
    ...(options.backend && { backend: options.backend }),
    ...(capMs !== undefined && { capMs }),
  })
}

/** The next check's timeout under `pace`, keyed as the step recorder will record that check. */
function pacer(pace: CheckPace, steps: StepRecorder, redact: (text: string) => string) {
  return (api: string, label: string, fallback: number) =>
    pacedTimeout(pace, checkKey(steps.next, api, redact(label)), fallback)
}

/** Waits for the active tab to be ready and notes the wait on the step that is running. */
function readyStep(readiness: Readiness, tabs: Tabs, steps: StepRecorder): () => Promise<void> {
  return async () => {
    const wait = await readiness.after(tabs.page)

    if (wait !== undefined) steps.event({ kind: "ready", at: new Date().toISOString(), ...wait })
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
  const { browser, context, page, own } = await openBrowser(options)
  const tabs = new Tabs(context, page)
  const settings = settingsOf(options)
  const { projectRoot, files, actionTimeout } = settings
  const vault = new SecretVault(options.secrets)
  const stopped = new AbortController()
  /* The recorder tells the flight about each step that ends; the flight reads the recorder. */
  const ended: { onStep?: (step: StepRecord) => void } = {}
  const steps = new StepRecorder({
    projectRoot,
    redact: vault.redact,
    onEnd: (step) => ended.onStep?.(step),
  })
  const flight = createSessionFlight({
    page: () => tabs.page,
    vault,
    steps,
    artifactsDir,
    stepScreenshots: settings.stepScreenshots,
  })

  const { backend } = options
  const providerFailures = backend?.failures && (() => backend.failures?.() ?? [])
  const appErrors = new AppErrors(options.baseUrl, options.appErrors, providerFailures)

  ended.onStep = (step) => flight.onStep(step)
  tabs.onEveryPage((opened) => {
    recordAppLog(opened, steps)
    appErrors.watch(opened)
  })

  const ready = readyStep(readinessOf(options), tabs, steps)
  const desk = new MailDesk(options.mail ?? [])
  const agent = createAgent({
    ready,
    appErrors,
    mail: desk,
    ...effectsOptions(options),
    tabs,
    appUrl: options.baseUrl,
    files,
    projectRoot,
    steps,
    vault,
    store,
    strict: settings.strict,
    relocation: settings.relocation,
    model: options.model,
    judge: options.judge,
    ...(options.judgeScreenshot !== undefined && { judgeScreenshot: options.judgeScreenshot }),
    vision: {
      mode: visionModeOf(options.vision, options.model),
      model: visionModelOf(options.vision),
    },
    ...(options.budget !== undefined && { budgets: options.budget }),
    ...(options.transcriptBudget !== undefined && { transcriptBudget: options.transcriptBudget }),
    context: options.agentContext,
    actionTimeout,
    assertionTimeout: settings.assertionTimeout,
    signal: stopped.signal,
  })
  const screen = createScreen({
    page: () => tabs.page,
    steps,
    files,
    secrets: { resolve: (secret) => vault.reveal(secret) },
    ready,
    actionTimeout,
    assertionTimeout: settings.assertionTimeout,
    ...(options.checkPace && { checkTimeout: pacer(options.checkPace, steps, vault.redact) }),
    shots: screenshotDesk(options, projectRoot, artifactsDir, steps),
  })
  let closed = false

  return {
    screen,
    expect,
    agent,
    divergence: () => agent.diverged(),
    secret: (name) => vault.handle(name),
    mail: mailOf(desk, tabs, steps, { timeout: actionTimeout, ready }),
    flight,
    app: appOf(tabs, steps, { baseUrl: options.baseUrl, loadTimeout: settings.loadTimeout, ready }),
    browserState: () => context.storageState({ indexedDB: true }),
    async close() {
      if (closed) return
      closed = true
      // A recording is written only once a later check confirmed what its step did.
      await store?.settle((step) => steps.verifiedAfter(step))
      await flight.settle()
      stopped.abort()

      try {
        await context.close()
      } finally {
        if (own) await browser.close()
        if (ownsArtifacts) await rm(artifactsDir, { recursive: true, force: true })
      }
    },
  }
}
