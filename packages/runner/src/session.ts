import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { LanguageModel } from "ai"
import type { Browser, BrowserContext, Page } from "playwright-core"

import { type Agent, createAgent, type ReplayDivergence } from "./agent/index.ts"
import { type Expect, expect } from "./assert/index.ts"
import type { BaselineUpdate, ScreenshotEvent } from "./assert/screenshot.ts"
import { type App, type BrowserFlags, launchBrowser } from "./browser/index.ts"
import { Tabs } from "./browser/tabs.ts"
import { createSessionFlight, type SessionFlight } from "./flight.ts"
import { createScreen, registerValueEngine, type Screen } from "./locate/index.ts"
import { recordAppLog, type StepRecord, StepRecorder } from "./record/index.ts"
import { type CacheMode, ReplayStore } from "./replay/index.ts"
import { type Secret, SecretVault, type SessionSecret } from "./secrets/index.ts"

export type { ReplayDivergence } from "./agent/index.ts"
export type { SessionSecret } from "./secrets/index.ts"

/** The app, and how long to wait for it. */
interface AppOptions {
  /** The app's base URL; `app.open(path)` resolves paths against it. */
  readonly baseUrl: string
  /** Default timeout of one action (click, fill), in milliseconds. */
  readonly actionTimeout?: number
  /** Default timeout of one `expect` poll, in milliseconds. */
  readonly assertionTimeout?: number
  /** Timeout of a page load, in milliseconds. */
  readonly timeout?: number
}

/** The browser behind the run's proxy. */
interface BrowserOptions {
  /** Route the browser through a danwo proxy and trust its per-run CA. */
  readonly proxy?: { readonly url: string; readonly caSpki: string }
  /** Extra launch options: `args` are added to the proxy's flags; `proxy` replaces the danwo proxy. */
  readonly launch?: BrowserFlags
  readonly headed?: boolean
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
   * Never under `strict-stop`, which follows its recordings exactly.
   */
  readonly relocate?: boolean
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
  /** What the attempt did, for the flight recorder; read `steps()` after `close()` for final records. */
  readonly flight: SessionFlight
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

async function openBrowser(options: WebSessionOptions): Promise<Opened> {
  await registerValueEngine()

  const browser = await launchBrowser({
    ...(options.proxy && { proxy: options.proxy }),
    ...(options.launch && { flags: options.launch }),
    headless: !(options.headed ?? false),
  })

  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    return { browser, context, page }
  } catch (error) {
    await browser.close()
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
    relocate: options.relocate ?? true,
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
function appOf(tabs: Tabs, steps: StepRecorder, baseUrl: string, loadTimeout: number): App {
  return {
    baseUrl,
    open: (path) =>
      steps.run("app", "app.open", path ?? "/", async () => {
        await tabs.page.goto(new URL(path ?? "/", baseUrl).href, { timeout: loadTimeout })
      }),
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
  const { browser, context, page } = await openBrowser(options)
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

  ended.onStep = (step) => flight.onStep(step)
  tabs.onEveryPage((opened) => recordAppLog(opened, steps))

  const agent = createAgent({
    tabs,
    appUrl: options.baseUrl,
    files,
    projectRoot,
    steps,
    vault,
    store,
    strict: settings.strict,
    relocate: settings.relocate,
    model: options.model,
    judge: options.judge,
    context: options.agentContext,
    actionTimeout,
    signal: stopped.signal,
  })
  const screen = createScreen({
    page: () => tabs.page,
    steps,
    files,
    secrets: { resolve: (secret) => vault.reveal(secret) },
    actionTimeout,
    assertionTimeout: settings.assertionTimeout,
    shots: screenshotDesk(options, projectRoot, artifactsDir, steps),
  })
  let closed = false

  return {
    screen,
    expect,
    agent,
    divergence: () => agent.diverged(),
    secret: (name) => vault.handle(name),
    flight,
    app: appOf(tabs, steps, options.baseUrl, settings.loadTimeout),
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
        await browser.close()
        if (ownsArtifacts) await rm(artifactsDir, { recursive: true, force: true })
      }
    },
  }
}
