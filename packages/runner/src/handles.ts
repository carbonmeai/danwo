/**
 * The handles a test works with on one person's browser context (`app`, `screen`, the agent,
 * `mail`), built the same way for the test's own browser and for every other person's browser it
 * opens. What the people of one attempt share (the replay cache, the secrets, the mail desk, the
 * clock) comes in through `SharedDesk`; what is theirs alone (tabs, steps, video) through `Browsing`.
 */
import { resolve } from "node:path"

import type { LanguageModel } from "ai"
import type { BrowserContext, Page } from "playwright-core"

import type { Budgets } from "./agent/budget.ts"
import { createAgent } from "./agent/index.ts"
import { type CheckPace, checkKey, pacedTimeout } from "./assert/pace.ts"
import type { BaselineUpdate, ScreenshotEvent } from "./assert/screenshot.ts"
import { type AppErrorOptions, AppErrors } from "./browser/app-errors.ts"
import type { App } from "./browser/index.ts"
import { type Backend, Readiness, type ReadinessMode } from "./browser/readiness.ts"
import { Tabs } from "./browser/tabs.ts"
import type { TabFilm } from "./browser/video.ts"
import { createScreen, type Screen } from "./locate/index.ts"
import type { MailDesk } from "./mail/desk.ts"
import type { MailMessage } from "./mail/index.ts"
import { recordAppLog, type StepRecorder } from "./record/index.ts"
import type { ReplayStore } from "./replay/index.ts"
import type { RelocationPolicy } from "./replay/policy.ts"
import type { SecretVault } from "./secrets/index.ts"
import { DanwoError } from "./support/codes.ts"
import { showTime, type TimeMachine } from "./time/index.ts"
import { type VisionSetting, visionModelOf, visionModeOf } from "./vision/desk.ts"

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
export function effectsOptions(options: {
  readonly effects?: EffectsSetting
  readonly backend?: Backend
}) {
  const { backend } = options
  const effects = effectsOf(options.effects)

  if (backend?.activity === undefined) return { effects }

  return { effects, activity: () => backend.activity?.() ?? { calls: [], deliveries: [] } }
}

/** The next check's timeout under `pace`, keyed as the step recorder will record that check. */
export function pacer(pace: CheckPace, steps: StepRecorder, redact: (text: string) => string) {
  return (api: string, label: string, fallback: number) =>
    pacedTimeout(pace, checkKey(steps.next, api, redact(label)), fallback)
}

/** The session options a browser's handles read; a session's options are a wider shape of these. */
export interface HandleOptions {
  readonly baseUrl: string
  readonly readiness?: ReadinessMode | { readonly mode?: ReadinessMode; readonly capMs?: number }
  readonly backend?: Backend
  readonly appErrors?: AppErrorOptions
  readonly checkPace?: CheckPace
  readonly effects?: EffectsSetting
  readonly model?: LanguageModel
  readonly judge?: LanguageModel
  readonly judgeScreenshot?: boolean
  readonly vision?: VisionSetting
  readonly budget?: Budgets
  readonly transcriptBudget?: number
  readonly agentContext?: string
  readonly screenshots?: { readonly dir?: string; readonly update?: BaselineUpdate }
  readonly onContext?: (context: BrowserContext) => Promise<void>
}

/** A browser's screenshot checks: baselines folder, a counter, and their notes on the step. */
function screenshotDesk(
  options: HandleOptions,
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

/** The session's settings with defaults filled in, as every person's handles read them. */
export interface Settings {
  readonly actionTimeout: number
  readonly assertionTimeout: number
  readonly loadTimeout: number
  readonly projectRoot: string
  readonly files: Readonly<Record<string, string>>
  readonly strict: boolean
  readonly relocation: RelocationPolicy
}

/** What every person's browser in one attempt shares. */
export interface SharedDesk {
  readonly options: HandleOptions
  readonly settings: Settings
  readonly store: ReplayStore | undefined
  readonly vault: SecretVault
  readonly desk: MailDesk
  readonly machine: TimeMachine
  readonly signal: AbortSignal
  readonly artifactsDir: string
  /** Every person's browser context: time travel moves the clock each of them shows. */
  readonly contexts: BrowserContext[]
}

/** One person's browser: its context, first page, step recorder and film. */
export interface Browsing {
  readonly context: BrowserContext
  readonly page: Page
  readonly steps: StepRecorder
  readonly film: TabFilm | undefined
}

/** The agent of one browser, which also tells where a strict replay stopped matching. */
export type BrowserAgent = ReturnType<typeof createAgent>

/** The handles of one person's browser. */
export interface Handles {
  readonly tabs: Tabs
  readonly ready: () => Promise<void>
  readonly agent: BrowserAgent
  readonly screen: Screen
  readonly app: App
  readonly mail: SessionMail
}

/** The session's readiness, from its settings: `page+backend` by default when a backend is given. */
function readinessOf(options: HandleOptions): Readiness {
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

/** Waits for the active tab to be ready and notes the wait on the step that is running. */
function readyStep(readiness: Readiness, tabs: Tabs, steps: StepRecorder): () => Promise<void> {
  return async () => {
    const wait = await readiness.after(tabs.page)

    if (wait !== undefined) steps.event({ kind: "ready", at: new Date().toISOString(), ...wait })
  }
}

/** `app` of a browser: the base URL, and opening a path of it on the active tab. */
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

/** `mail` of a browser: reading the app's mail, and showing a message in the active tab. */
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

/** The agent of one browser, travelling time for every browser of the attempt at once. */
function agentFor(
  shared: SharedDesk,
  browsing: Browsing,
  tabs: Tabs,
  extra: AgentExtra,
): BrowserAgent {
  const { options, settings, machine } = shared

  return createAgent({
    ready: extra.ready,
    travel: async (ms) => {
      await machine.travel(ms)
      for (const context of shared.contexts) await showTime(context, machine)
    },
    appErrors: extra.appErrors,
    mail: shared.desk,
    ...effectsOptions(options),
    tabs,
    appUrl: options.baseUrl,
    files: settings.files,
    projectRoot: settings.projectRoot,
    steps: browsing.steps,
    vault: shared.vault,
    store: shared.store,
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
    actionTimeout: settings.actionTimeout,
    assertionTimeout: settings.assertionTimeout,
    signal: shared.signal,
  })
}

interface AgentExtra {
  readonly ready: () => Promise<void>
  readonly appErrors: AppErrors
}

/** The app's failures in this browser: its error responses and uncaught errors, and provider failures. */
function appErrorsOf(options: HandleOptions): AppErrors {
  const { backend } = options
  const providerFailures = backend?.failures && (() => backend.failures?.() ?? [])

  return new AppErrors(options.baseUrl, options.appErrors, providerFailures)
}

/** Builds the handles of one person's browser, watching every tab it opens. */
export function handlesFor(shared: SharedDesk, browsing: Browsing): Handles {
  const { options, settings, vault } = shared
  const { steps, film } = browsing
  const tabs = new Tabs(browsing.context, browsing.page)
  const appErrors = appErrorsOf(options)

  steps.followTabs(() => tabs.activeNumber)

  tabs.onEveryPage((opened) => {
    recordAppLog(opened, steps)
    appErrors.watch(opened)
    film?.watch(opened)
  })

  const ready = readyStep(readinessOf(options), tabs, steps)
  const agent = agentFor(shared, browsing, tabs, { ready, appErrors })
  const screen = createScreen({
    page: () => tabs.page,
    steps,
    files: settings.files,
    secrets: { resolve: (secret) => vault.reveal(secret) },
    ready,
    actionTimeout: settings.actionTimeout,
    assertionTimeout: settings.assertionTimeout,
    ...(options.checkPace && { checkTimeout: pacer(options.checkPace, steps, vault.redact) }),
    shots: screenshotDesk(options, settings.projectRoot, shared.artifactsDir, steps),
  })

  return {
    tabs,
    ready,
    agent,
    screen,
    app: appOf(tabs, steps, { baseUrl: options.baseUrl, loadTimeout: settings.loadTimeout, ready }),
    mail: mailOf(shared.desk, tabs, steps, { timeout: settings.actionTimeout, ready }),
  }
}
