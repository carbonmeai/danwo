/**
 * A session's browser, driven one tool call at a time: the page as an accessibility snapshot with
 * refs, actions on a ref or a locator, locator checks, screenshots with secrets masked, and
 * recordings. Each action answers with what changed on the page and what the page reported since
 * the last call. Every text that leaves is redacted.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { locate, locatorCode, parseLocator } from "@danwo/recorder"
import type { SecretVault } from "@danwo/runner"
import type { Browser, BrowserContext, Locator, Page } from "playwright-core"

import { snapshotChange } from "./diff.ts"
import { checkLocator } from "./locator-check.ts"
import type { SessionAnswer, SessionCall } from "./protocol.ts"
import { filePayloads, putFiles, uploadAnswer } from "./upload.ts"
import { PageWatch } from "./watch.ts"

/** About 20k tokens of page text at most. */
const MAX_TREE_CHARS = 80_000
const ACTION_TIMEOUT_MS = 10_000
const LOAD_TIMEOUT_MS = 30_000
const SECRET_MARK = "data-danwo-secret"

export type ActionCall = Extract<
  SessionCall,
  {
    kind:
      | "click"
      | "hover"
      | "fill"
      | "fill_secret"
      | "press"
      | "select"
      | "check"
      | "navigate"
      | "upload"
  }
>

export interface DeskOptions {
  readonly browser: Browser
  readonly baseUrl: string
  readonly vault: SecretVault
  readonly redact: (text: string) => string
  /** The project folder, which upload paths resolve against. */
  readonly root: string
  /** The files the config offers tests by name, as paths in the project. */
  readonly files?: Readonly<Record<string, string>> | undefined
  /** Where this session's recordings go, and how to name it to the agent. */
  readonly recordDir: { readonly path: string; readonly shown: string }
}

interface Recording {
  frames: number
  readonly video: boolean
}

interface Targeted {
  readonly locator: Locator
  /** How the answer names what was acted on. */
  readonly name: string
}

export class PageDesk {
  private tree = ""
  private secretFilled = false
  private recording: Recording | undefined
  private readonly watch: PageWatch
  private readonly options: DeskOptions
  private context: BrowserContext
  private page: Page

  private constructor(options: DeskOptions, context: BrowserContext, page: Page) {
    this.options = options
    this.context = context
    this.page = page
    this.watch = new PageWatch(options.redact)
    this.watch.attach(context, (opened) => {
      this.page = opened
    })
  }

  /** A fresh browser context on `path` of the app; answers with the first snapshot. */
  static async open(options: DeskOptions, path: string): Promise<{ desk: PageDesk; text: string }> {
    const context = await options.browser.newContext()
    const page = await context.newPage()
    const desk = new PageDesk(options, context, page)

    await page.goto(new URL(path, options.baseUrl).href, { timeout: LOAD_TIMEOUT_MS })

    return { desk, text: await desk.snapshot() }
  }

  /** The whole page now, with refs to act on. */
  async snapshot(): Promise<string> {
    const view = await this.view()

    return [`url: ${view.url}`, `title: ${view.title}`, "", view.tree, ...this.events()].join("\n")
  }

  /** Carries out one action, then answers with the page's change and what it reported. */
  async act(call: ActionCall): Promise<string> {
    const before = this.tree
    const url = this.page.url()
    const done = await perform(this, call)

    await this.settle()

    const view = await this.view()
    const moved = this.page.url() !== url

    await this.frame(call.kind)

    return [
      done,
      `url: ${view.url}${moved ? ` (was ${this.options.redact(url)})` : ""}`,
      ...this.changeLines(moved ? "" : before, view),
      ...this.events(),
    ].join("\n")
  }

  check(expression: string): Promise<string> {
    return checkLocator(this.page, expression, this.tree, this.options.redact)
  }

  async screenshot(target: string | undefined, fullPage: boolean): Promise<SessionAnswer> {
    const mask = this.masks()
    const shot =
      target === undefined
        ? await this.page.screenshot({ fullPage, mask })
        : await (await this.target(target)).locator.screenshot({ mask })

    return {
      text: `screenshot of ${target ?? (fullPage ? "the whole page" : "the viewport")} (secret fields and values masked)`,
      image: { data: shot.toString("base64"), mimeType: "image/png" },
    }
  }

  async startRecording(video: boolean): Promise<string> {
    if (this.recording !== undefined)
      throw new Error("this session is already recording: stop_recording first")
    if (video && this.secretFilled)
      throw new Error(
        "a secret was filled in this session, and a video cannot mask it: record screenshots only (video: false)",
      )

    await mkdir(this.options.recordDir.path, { recursive: true })
    if (video) await this.swapContext(this.options.recordDir.path)
    this.recording = { frames: 0, video }
    await this.frame("start")

    return `recording into ${this.options.recordDir.shown}: a screenshot after every action${video ? ", and a video" : ""}`
  }

  async stopRecording(): Promise<string> {
    const recording = this.recording

    if (recording === undefined) throw new Error("this session is not recording")

    await this.frame("stop")
    this.recording = undefined

    const video = recording.video ? await this.finishVideo() : undefined

    return [
      `recorded ${recording.frames} screenshots in ${this.options.recordDir.shown}`,
      ...(video === undefined ? [] : [`video: ${video}`]),
    ].join("\n")
  }

  async close(): Promise<void> {
    if (this.recording?.video) await this.finishVideo().catch(() => undefined)
    await this.context.close().catch(() => undefined)
  }

  /** The element `target` names: a ref of the latest snapshot, or a locator matching one element. */
  async target(target: string): Promise<Targeted> {
    const ref = /^(?:ref=)?((?:f\d+)?e\d+)$/.exec(target.trim())?.[1]

    if (ref !== undefined) return { locator: this.page.getByRef(ref), name: this.refName(ref) }

    const query = parseLocator(target)
    const code = locatorCode(query)
    const locator = locate(this.page, query)
    const count = await locator.count()

    if (count !== 1)
      throw new Error(
        count === 0
          ? `${code} matches no element (check_locator shows the nearest ones)`
          : `${code} matches ${count} elements, and an action needs exactly one (check_locator lists them)`,
      )

    return { locator, name: code }
  }

  async fillSecret(target: string, name: string): Promise<string> {
    if (this.recording?.video)
      throw new Error("a video is recording and cannot mask a secret: stop_recording first")

    const { locator, name: shown } = await this.target(target)
    const { vault } = this.options

    await locator.fill(await vault.reveal(vault.handle(name)), { timeout: ACTION_TIMEOUT_MS })
    await locator.evaluate((element, mark) => element.setAttribute(mark, ""), SECRET_MARK)
    this.secretFilled = true

    return `filled secret "${name}" into ${shown}`
  }

  async navigate(to: string): Promise<string> {
    const options = { timeout: LOAD_TIMEOUT_MS }

    if (to === "back") await this.page.goBack(options)
    else if (to === "forward") await this.page.goForward(options)
    else if (to === "reload") await this.page.reload(options)
    else await this.page.goto(new URL(to, this.options.baseUrl).href, options)

    return `went to ${to}`
  }

  async upload(call: Extract<ActionCall, { kind: "upload" }>): Promise<string> {
    const payloads = await filePayloads(call.files, {
      root: this.options.root,
      offered: this.options.files ?? {},
    })
    const { locator, name } = await this.target(call.target)

    await putFiles(locator, payloads, ACTION_TIMEOUT_MS)

    return this.options.redact(uploadAnswer(call.files, payloads, name))
  }

  get keyboard() {
    return this.page.keyboard
  }

  private refName(ref: string): string {
    const line = this.tree.split("\n").find((text) => text.includes(`[ref=${ref}]`))

    if (line === undefined)
      throw new Error(`${ref} is not in the latest snapshot: take a snapshot and use its refs`)

    return `${ref} (${line
      .replace(/ \[ref=(?:f\d+)?e\d+\]/, "")
      .replace(/^\s*- /, "")
      .trim()})`
  }

  private async view(): Promise<{ url: string; title: string; tree: string }> {
    const raw = await this.page.ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS })
    const capped =
      raw.length > MAX_TREE_CHARS
        ? `${raw.slice(0, MAX_TREE_CHARS)}\n… (page cut at ${MAX_TREE_CHARS} characters)`
        : raw
    const { redact } = this.options

    this.tree = redact(capped)

    return { url: redact(this.page.url()), title: redact(await this.page.title()), tree: this.tree }
  }

  private changeLines(before: string, view: { title: string; tree: string }): string[] {
    const change = before === "" ? { kind: "whole" as const } : snapshotChange(before, view.tree)

    if (change.kind === "same") return ["page unchanged"]
    if (change.kind === "diff") return ["page changes (- gone, + new):", ...change.lines]

    return [`title: ${view.title}`, "page:", view.tree]
  }

  private events(): string[] {
    const lines = this.watch.drain()

    return lines.length === 0
      ? []
      : ["", "since the last call:", ...lines.map((line) => `  ${line}`)]
  }

  /** Lets the page finish what the action started: its load, then a short wait for quiet. */
  private async settle(): Promise<void> {
    await this.page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined)
    await this.page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => undefined)
  }

  /** What a screenshot hides: password fields, filled secrets, and any text showing a secret. */
  private masks(): Locator[] {
    return [
      this.page.locator(`input[type=password], [${SECRET_MARK}]`),
      ...this.options.vault.values().map((value) => this.page.getByText(value)),
    ]
  }

  private async frame(label: string): Promise<void> {
    const recording = this.recording

    if (recording === undefined) return

    recording.frames += 1

    const name = `${String(recording.frames).padStart(3, "0")}-${label}.png`
    const shot = await this.page.screenshot({ mask: this.masks() }).catch(() => undefined)

    if (shot !== undefined) await writeFile(join(this.options.recordDir.path, name), shot)
  }

  /**
   * Moves the session to a new browser context with the same cookies and storage on the same
   * page, recording video into `videoDir` when given. Video can only be switched on when a context
   * starts.
   */
  private async swapContext(videoDir?: string): Promise<void> {
    const old = this.context
    const url = this.page.url()
    const context = await this.options.browser.newContext({
      storageState: await old.storageState(),
      ...(videoDir !== undefined && { recordVideo: { dir: videoDir } }),
    })
    const page = await context.newPage()

    this.watch.attach(context, (opened) => {
      this.page = opened
    })
    if (url !== "about:blank") await page.goto(url, { timeout: LOAD_TIMEOUT_MS })
    this.context = context
    this.page = page
    await old.close()
  }

  /** Ends the video: back to a context without one, which saves the file. */
  private async finishVideo(): Promise<string | undefined> {
    const video = this.page.video()

    await this.swapContext()

    return video === null ? undefined : this.options.redact(await video.path())
  }
}

/** Each action by kind, carried out on the desk; answers with what was done. */
const ACTIONS: {
  readonly [K in ActionCall["kind"]]: (
    desk: PageDesk,
    call: Extract<ActionCall, { kind: K }>,
  ) => Promise<string>
} = {
  async click(desk, call) {
    const { locator, name } = await desk.target(call.target)

    await locator.click({ timeout: ACTION_TIMEOUT_MS })

    return `clicked ${name}`
  },
  async hover(desk, call) {
    const { locator, name } = await desk.target(call.target)

    await locator.hover({ timeout: ACTION_TIMEOUT_MS })

    return `hovered ${name}`
  },
  async fill(desk, call) {
    const { locator, name } = await desk.target(call.target)

    await locator.fill(call.value, { timeout: ACTION_TIMEOUT_MS })

    return `filled ${name}`
  },
  fill_secret: (desk, call) => desk.fillSecret(call.target, call.secret),
  async press(desk, call) {
    if (call.target === undefined) {
      await desk.keyboard.press(call.key)

      return `pressed ${call.key}`
    }

    const { locator, name } = await desk.target(call.target)

    await locator.press(call.key, { timeout: ACTION_TIMEOUT_MS })

    return `pressed ${call.key} on ${name}`
  },
  async select(desk, call) {
    const { locator, name } = await desk.target(call.target)

    await locator.selectOption([...call.values], { timeout: ACTION_TIMEOUT_MS })

    return `selected ${call.values.join(", ")} in ${name}`
  },
  async check(desk, call) {
    const { locator, name } = await desk.target(call.target)

    await locator.setChecked(call.checked, { timeout: ACTION_TIMEOUT_MS })

    return `${call.checked ? "checked" : "unchecked"} ${name}`
  },
  navigate: (desk, call) => desk.navigate(call.to),
  upload: (desk, call) => desk.upload(call),
}

/** Carries out `call` with the action of its kind. */
function perform(desk: PageDesk, call: ActionCall): Promise<string> {
  switch (call.kind) {
    case "click":
      return ACTIONS.click(desk, call)
    case "hover":
      return ACTIONS.hover(desk, call)
    case "fill":
      return ACTIONS.fill(desk, call)
    case "fill_secret":
      return ACTIONS.fill_secret(desk, call)
    case "press":
      return ACTIONS.press(desk, call)
    case "select":
      return ACTIONS.select(desk, call)
    case "check":
      return ACTIONS.check(desk, call)
    case "upload":
      return ACTIONS.upload(desk, call)
    default:
      return ACTIONS.navigate(desk, call)
  }
}
