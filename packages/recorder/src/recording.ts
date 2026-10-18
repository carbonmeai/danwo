/**
 * A recording: the project's environment (app, emulators, proxy) and a browser behind the proxy,
 * where a person uses the app while the recorder writes down what they do as test lines, and what
 * each action caused behind the app as provider calls and webhooks. Stopping turns it into a new
 * `*.danwo.ts` file with an invariant drafted from those effects.
 */
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"

import { launchBrowser } from "@danwo/runner"
import {
  backendOf,
  type DanwoConfig,
  loadConfig,
  type WorkerEnvironment,
} from "@danwo/runner/runner"
import type { Browser, BrowserContext, Frame, Page } from "playwright-core"

import { BINDING, type PageEvent, pageEventSchema } from "./events.ts"
import { finishRecording, type FinishOptions, type RecordedTest } from "./finish.ts"
import { StepWriter } from "./step-writer.ts"
import { type ActionStep, type Mark, type Step } from "./steps.ts"

/** How a recording starts. */
export interface RecordOptions {
  /** The project's folder; its nearest `danwo.config.ts` sets up the environment. */
  readonly cwd: string
  readonly config?: string | undefined
  /** The app page the recording starts on. Default `/`. */
  readonly path?: string | undefined
  /** Without a window, for tests that drive the recording's page themselves. Default false. */
  readonly headless?: boolean | undefined
}

/** Navigations this soon after an action are what the action did, not a new page the person typed. */
const NAVIGATION_GRACE_MS = 3_000
/** How long the recorder waits after an action before letting the backend finish its work. */
const SETTLE_DELAY_MS = 250
/** The longest the backend is waited on after one action. */
const SETTLE_CAP_MS = 5_000

const PAGE_SCRIPT = new URL("./page-script.ts", import.meta.url)

/** The page script as the browser runs it: types stripped, the module marker left out. */
async function pageScript(): Promise<string> {
  const source = await readFile(PAGE_SCRIPT, "utf8")

  return stripTypeScriptTypes(source).replace(/^export \{\}\s*$/m, "")
}

type Backend = NonNullable<ReturnType<typeof backendOf>>

/** A running recording; `finish` writes its test and closes everything it started. */
export class Recording {
  readonly page: Page
  /** Settles when the person presses Stop on the toolbar, or closes the browser. */
  readonly stopped: Promise<void>

  private readonly env: WorkerEnvironment | undefined
  private readonly browser: Browser
  private readonly backend: Backend | undefined
  private readonly writer: StepWriter
  private readonly config: DanwoConfig
  private readonly root: string
  private queue: Promise<unknown> = Promise.resolve()
  private settling: Promise<unknown> = Promise.resolve()
  private lastAction = 0
  private stop: () => void = () => undefined

  private constructor(parts: RecordingParts) {
    this.env = parts.env
    this.browser = parts.browser
    this.page = parts.page
    this.config = parts.config
    this.root = parts.root
    this.backend = backendOf(parts.env, { settle: true })
    this.writer = new StepWriter({ baseUrl: parts.baseUrl, mail: parts.env?.mail ?? [] })
    this.stopped = new Promise((resolve) => {
      this.stop = resolve
    })
  }

  /** Starts the environment and the browser, and opens `path`. */
  static async start(options: RecordOptions): Promise<Recording> {
    const parts = await startParts(options)
    const recording = new Recording(parts)

    await recording.watch(parts.context)
    await recording.open(options.path ?? "/")

    return recording
  }

  /** Where the backend's history stands now. */
  private mark(): Mark {
    const activity = this.backend?.activity?.()

    return { calls: activity?.calls.length ?? 0, deliveries: activity?.deliveries.length ?? 0 }
  }

  private async watch(context: BrowserContext): Promise<void> {
    await context.exposeBinding(BINDING, (source: { page: Page }, payload: unknown) =>
      this.enqueue(source.page, payload),
    )
    await context.addInitScript({ content: await pageScript() })
    this.page.on("framenavigated", (frame) => this.navigated(frame))
    this.page.on("close", () => this.stop())
  }

  private async open(path: string): Promise<void> {
    this.push({
      kind: "action",
      line: `await app.open(${JSON.stringify(path)})`,
      mark: this.mark(),
    })
    this.lastAction = performance.now()
    await this.page.goto(new URL(path, this.writer.baseUrl).href)
    this.afterAction()
  }

  private push(step: Step): void {
    this.writer.push(step)
  }

  /** Handles page events one at a time, in the order the page sent them. */
  private enqueue(page: Page, payload: unknown): Promise<unknown> {
    const handled = this.queue.then(() => this.handle(page, payload))

    this.queue = handled.catch(() => undefined)

    return handled.catch((error: unknown) => {
      process.stderr.write(
        `danwo record: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    })
  }

  private async handle(page: Page, payload: unknown): Promise<void> {
    const event: PageEvent = pageEventSchema.parse(payload)

    if (event.kind === "stop") {
      this.stop()

      return
    }

    if (event.kind === "note") {
      this.push({ kind: "note", text: event.text })

      return
    }

    const step = await this.writer.stepFor(page, event, this.mark())

    if (step !== undefined) this.push(step)
    if (event.kind !== "assert" && event.kind !== "fill") this.lastAction = performance.now()
    if (event.kind !== "assert") this.afterAction()
  }

  /** Lets the backend finish what an action started, so the app sees its webhooks as it would. */
  private afterAction(): void {
    const backend = this.backend

    if (backend === undefined) return

    this.settling = this.settling
      .then(() => new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS)))
      .then(() => backend.quiet(SETTLE_CAP_MS))
      .catch(() => undefined)
  }

  /** A page the person went to themselves, by typing its address or following a mail link. */
  private navigated(frame: Frame): void {
    if (frame !== this.page.mainFrame()) return
    if (performance.now() - this.lastAction < NAVIGATION_GRACE_MS) return

    const step: ActionStep | undefined = this.writer.openStep(frame.url(), this.mark())

    if (step === undefined) return

    this.lastAction = performance.now()
    this.push(step)
    this.afterAction()
  }

  /** Stops recording, writes the test, and closes the browser and the environment. */
  // fallow-ignore-next-line unused-class-member -- called by `danwo record` on the recording startRecording returns
  async finish(options: FinishOptions = {}): Promise<RecordedTest> {
    this.stop()
    await this.queue
    await this.settling
    await this.backend?.quiet(SETTLE_CAP_MS)

    try {
      return await finishRecording({
        options,
        steps: this.writer.steps(),
        activity: this.backend?.activity?.(),
        env: this.env,
        config: this.config,
        root: this.root,
        secrets: this.writer.secrets(),
        appHost: new URL(this.writer.baseUrl).hostname,
      })
    } finally {
      await this.browser.close().catch(() => undefined)
      await this.env?.close().catch(() => undefined)
    }
  }
}

interface RecordingParts {
  readonly env: WorkerEnvironment | undefined
  readonly browser: Browser
  readonly context: BrowserContext
  readonly page: Page
  readonly baseUrl: string
  readonly config: DanwoConfig
  readonly root: string
}

/** A browser behind the environment's proxy, when it has one, with one page open. */
async function openBrowser(env: WorkerEnvironment | undefined, headless: boolean) {
  const proxy = env?.proxy && { url: env.proxy.url, caSpki: env.proxy.caSpki }
  const browser = await launchBrowser({ ...(proxy && { proxy }), headless })
  const context = await browser.newContext()

  return { browser, context, page: await context.newPage() }
}

/** The environment, a browser behind its proxy, and one page, closed again if any part fails. */
async function startParts(options: RecordOptions): Promise<RecordingParts> {
  const loaded = await loadConfig(options.cwd, options.config)
  const env = await loaded.config.environment?.({ workerIndex: 0 })
  const baseUrl = env?.baseUrl ?? loaded.config.baseUrl

  try {
    if (baseUrl === undefined)
      throw new Error("the project has no baseUrl: set one in danwo.config.ts or its environment")

    const opened = await openBrowser(env, options.headless ?? false)

    return { env, ...opened, baseUrl, config: loaded.config, root: loaded.root }
  } catch (error) {
    await env?.close().catch(() => undefined)
    throw error
  }
}

/** Starts recording; see {@link Recording}. */
export function startRecording(options: RecordOptions): Promise<Recording> {
  return Recording.start(options)
}
