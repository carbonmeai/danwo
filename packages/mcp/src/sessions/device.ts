/**
 * A session's device, driven one tool call at a time: the environment's Android emulator or iOS
 * Simulator with the app in front. The screen reads as a tree with refs, actions map to the
 * device's own (a click is a tap; fill, press, back, scroll, a tap at a point), and every answer
 * says what is in front: the app, or a browser it opened. A ref is checked against a fresh reading
 * before each action, so a tap never lands where an element used to be. Screenshots paint over
 * password fields, fields a secret was filled into and any secret's value. Every text that leaves
 * is redacted.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SecretVault } from "@danwo/runner"
import type {
  DeviceBox,
  DeviceForeground,
  DeviceNode,
  DeviceTarget,
  ScreenFilm,
} from "@danwo/runner/runner"

import {
  type ActionCall,
  browserOnlyText,
  deviceName,
  isBrowserOnly,
  type SessionDesk,
} from "./desk.ts"
import { matchDevice, parseDeviceLocator, checkDeviceLocator } from "./device-locator.ts"
import { maskedShot } from "./device-shot.ts"
import { boxText, identity, RefBook, type RefCheck, type RefReading } from "./device-tree.ts"
import { snapshotChange } from "./diff.ts"
import type { SessionAnswer } from "./protocol.ts"

/** About 20k tokens of screen text at most. */
const MAX_TREE_CHARS = 80_000
/** How long the services behind the app may take to go quiet after an action. */
const BACKEND_QUIET_MS = 5_000
/** How long the screen may keep changing after an action before the answer reads it anyway. */
const SCREEN_SETTLE_MS = 1_500
const SCREEN_POLL_MS = 120
/** At most this many log lines are kept between calls; the rest are counted. */
const MAX_EVENTS = 30

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface DeviceDeskOptions {
  readonly target: DeviceTarget
  readonly vault: SecretVault
  readonly redact: (text: string) => string
  /** The services behind the app, waited for after every action. */
  readonly backend?: { quiet(timeoutMs: number): Promise<void> } | undefined
  /** Where this session's recordings go, and how to name it to the agent. */
  readonly recordDir: { readonly path: string; readonly shown: string }
}

/** The element an action works on, as the latest reading has it. */
interface Targeted {
  readonly node: DeviceNode
  /** How the answer names it. */
  readonly name: string
}

interface Recording {
  frames: number
  readonly film: ScreenFilm | undefined
}

/** The actions a device carries out: all but a browser's own. */
type DeviceAction = Exclude<ActionCall, { kind: BrowserOnlyKind }>
type BrowserOnlyKind =
  | "hover"
  | "select"
  | "upload"
  | "drag"
  | "switch_tab"
  | "close_tab"
  | "dialog"

/** One reading's shape, to tell when the screen stops changing. */
function signature(nodes: readonly DeviceNode[]): string {
  return nodes.map((node) => `${node.role}|${node.name}|${node.text}`).join("\n")
}

/** An element as an answer names it: `button "Pay"`. */
function described(node: DeviceNode): string {
  const name = node.name || (node.editable ? "" : node.text)

  return `${node.role}${name === "" ? "" : ` ${JSON.stringify(name)}`}`
}

function sameFront(a: DeviceForeground | undefined, b: DeviceForeground): boolean {
  return a !== undefined && a.package === b.package && a.browser === b.browser && a.url === b.url
}

/** What is in front, as an answer's line. */
function frontText(front: DeviceForeground): string {
  if (!front.browser) return `the app ${front.package}`

  return `a browser the app opened (${front.package})${front.url === undefined ? "" : ` at ${front.url}`}`
}

/** Why a ref the agent holds cannot be acted on. */
function staleText(ref: string, checked: Exclude<RefCheck, { kind: "same" }>): string {
  const was = `${ref} (${described(checked.was)})`

  return checked.kind === "gone"
    ? `${was} is no longer on the screen`
    : `${was} moved since the last snapshot: it was at ${boxText(checked.was.box)}, now at ${boxText(checked.node.box)}`
}

/** Whether a click asks for what only a mouse has. */
function mouseOnly(call: Extract<ActionCall, { kind: "click" }>): boolean {
  return (
    (call.modifiers !== undefined && call.modifiers.length > 0) ||
    (call.button !== undefined && call.button !== "left") ||
    call.double === true
  )
}

export class DeviceDesk implements SessionDesk {
  private readonly options: DeviceDeskOptions
  private readonly book = new RefBook()
  /** The screen as the agent last read it. */
  private tree = ""
  /** What was in front when the agent last read the screen. */
  private front: DeviceForeground | undefined
  /** The fields a secret was filled into, by what they are. */
  private readonly secretFields = new Set<string>()
  private secretFilled = false
  private recording: Recording | undefined

  private constructor(options: DeviceDeskOptions) {
    this.options = options
  }

  private get target(): DeviceTarget {
    return this.options.target
  }

  /** The app afresh on the device (deep-linked to `path` when it has one); answers with the screen. */
  static async open(
    options: DeviceDeskOptions,
    path: string,
  ): Promise<{ desk: DeviceDesk; text: string }> {
    const desk = new DeviceDesk(options)

    await options.target.startApp()
    if (path !== "" && path !== "/") await desk.openPath(path)
    await desk.settle()

    return { desk, text: await desk.snapshot() }
  }

  /** The whole screen now, with refs to act on. */
  async snapshot(): Promise<string> {
    const reading = await this.read()
    const front = await this.foreground()

    return [
      `device: ${deviceName(this.target.platform)}`,
      `in front: ${frontText(front)}`,
      "",
      this.render(reading),
      ...(await this.events()),
    ].join("\n")
  }

  /** Carries out one action, then answers with what is in front and what changed. */
  async act(call: ActionCall): Promise<string> {
    if (isBrowserOnly(call)) throw new Error(browserOnlyText(call.kind, this.target.platform))

    const before = this.tree
    const frontBefore = this.front
    const done = await this.perform(call)

    await this.settle()

    const reading = await this.read()
    const front = await this.foreground()
    const changed = !sameFront(frontBefore, front)
    const tree = this.render(reading)

    await this.frame(call.kind)

    return [
      done,
      `in front: ${frontText(front)}${changed && frontBefore !== undefined ? ` (was ${frontText(frontBefore)})` : ""}`,
      ...changeLines(changed ? "" : before, tree),
      ...(await this.events()),
    ].join("\n")
  }

  check(expression: string): Promise<string> {
    return this.read().then((reading) =>
      checkDeviceLocator(reading.nodes, expression, this.options.redact),
    )
  }

  async screenshot(target: string | undefined, fullPage: boolean): Promise<SessionAnswer> {
    const within = target === undefined ? undefined : (await this.targetOf(target)).node.box

    if (target !== undefined && within === undefined)
      throw new Error(`${target} has no place on the screen to take a picture of`)

    const shot = await this.shot(within)

    return {
      text: `screenshot of ${target ?? "the screen"}${fullPage ? " (a device shows one screen at a time)" : ""} (password fields, secret fields and values masked)`,
      image: { data: shot.toString("base64"), mimeType: "image/png" },
    }
  }

  tabList(): Promise<string> {
    return Promise.reject(new Error(browserOnlyText("tabs", this.target.platform)))
  }

  async startRecording(video: boolean): Promise<string> {
    if (this.recording !== undefined)
      throw new Error("this session is already recording: stop_recording first")
    if (video && this.secretFilled)
      throw new Error(
        "a secret was filled in this session, and a video cannot mask it: record screenshots only (video: false)",
      )

    const { path, shown } = this.options.recordDir

    await mkdir(path, { recursive: true })

    const film = video ? await this.startFilm(join(path, "screen.mp4")) : undefined

    this.recording = { frames: 0, film }
    await this.frame("start")

    return `recording into ${shown}: a screenshot after every action${video ? ", and a video of the screen" : ""}`
  }

  async stopRecording(): Promise<string> {
    const recording = this.recording

    if (recording === undefined) throw new Error("this session is not recording")

    await this.frame("stop")
    this.recording = undefined

    const { shown } = this.options.recordDir
    const filmed = (await recording.film?.stop().catch(() => false)) ?? false

    return [
      `recorded ${recording.frames} screenshots in ${shown}`,
      ...(filmed ? [`video: ${shown}screen.mp4`] : []),
      ...(recording.film !== undefined && !filmed ? ["the video could not be written"] : []),
    ].join("\n")
  }

  async close(): Promise<void> {
    await this.recording?.film?.stop().catch(() => false)
    this.recording = undefined
  }

  private async startFilm(path: string): Promise<ScreenFilm> {
    const film = await this.target.recordScreen?.(path)

    if (film === undefined)
      throw new Error(
        `this ${deviceName(this.target.platform)} cannot film its screen: record screenshots only (video: false)`,
      )

    return film
  }

  /** Reads the screen and gives its elements the session's refs. */
  private async read(): Promise<RefReading> {
    return this.book.assign((await this.target.read()).nodes)
  }

  private async foreground(): Promise<DeviceForeground> {
    const front = await this.target.foreground()

    this.front = {
      ...front,
      ...(front.url !== undefined && { url: this.options.redact(front.url) }),
    }

    return this.front
  }

  /** The reading as the agent sees it: redacted and capped. */
  private render(reading: RefReading): string {
    const raw = this.book.render(reading)
    const capped =
      raw.length > MAX_TREE_CHARS
        ? `${raw.slice(0, MAX_TREE_CHARS)}\n… (screen cut at ${MAX_TREE_CHARS} characters)`
        : raw

    this.tree = this.options.redact(capped)

    return this.tree
  }

  /**
   * The element `target` names in a fresh reading: a ref the agent was shown, still where it was,
   * or a locator matching exactly one element. A ref that moved or went refuses, with the screen
   * as it is now, so nothing is tapped where the element used to be.
   */
  private async targetOf(target: string): Promise<Targeted> {
    const ref = /^(?:ref=)?(e\d+)$/.exec(target.trim())?.[1]
    const reading = await this.read()

    if (ref === undefined) return this.located(target, reading)

    const checked = this.book.check(ref, reading)

    if (checked === undefined)
      throw new Error(`${ref} is not in the latest snapshot: take a snapshot and use its refs`)
    if (checked.kind === "same")
      return { node: checked.node, name: `${ref} (${described(checked.node)})` }

    const tree = this.render(reading)

    throw new Error(
      this.options.redact(
        [`${staleText(ref, checked)}. Nothing was done; the screen now:`, "", tree].join("\n"),
      ),
    )
  }

  private located(expression: string, reading: RefReading): Targeted {
    const locator = parseDeviceLocator(expression)
    const matched = matchDevice(reading.nodes, locator)
    const [only] = matched

    if (matched.length === 1 && only !== undefined) return { node: only, name: locator.code }
    if (matched.length === 0)
      throw new Error(`${locator.code} matches no element (check_locator shows the nearest ones)`)

    throw new Error(
      `${locator.code} matches ${matched.length} elements, and an action needs exactly one (check_locator lists them; .first() or .nth(n) picks one)`,
    )
  }

  /** Opens a path of the app by its link scheme, or a full URL with the device's handler for it. */
  private async openPath(to: string): Promise<string> {
    if (/^[a-z][\w+.-]*:\/\//i.test(to)) {
      await this.target.openLink(to)

      return `opened ${to}`
    }

    const { scheme } = this.target

    if (scheme === undefined)
      throw new Error(
        `the app has no link scheme to open ${to} with: give a full URL, or the device's scheme in its options`,
      )

    await this.target.openLink(`${scheme}://${to.replace(/^\//, "")}`)

    return `opened ${scheme}://${to.replace(/^\//, "")}`
  }

  private async perform(call: DeviceAction): Promise<string> {
    switch (call.kind) {
      case "click":
        return this.tap(call)
      case "fill":
        return this.fill(call.target, call.value)
      case "fill_secret":
        return this.fillSecret(call.target, call.secret)
      case "press":
        return this.press(call.key, call.target)
      case "check":
        return this.setChecked(call.target, call.checked)
      case "navigate":
        return this.navigate(call.to)
      case "back":
        await this.target.back()

        return "went back"
      case "scroll":
        return this.scroll(call.direction, call.target)
      default:
        return this.tapAt(call.x, call.y)
    }
  }

  private async tap(call: Extract<ActionCall, { kind: "click" }>): Promise<string> {
    if (mouseOnly(call))
      throw new Error(
        "modifiers, other buttons and double clicks work on a browser page only: on a device, click is a single tap",
      )

    const { node, name } = await this.targetOf(call.target)

    await this.target.tap(node.ref)

    return `tapped ${name}`
  }

  private async fill(target: string, value: string): Promise<string> {
    const { node, name } = await this.targetOf(target)

    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- the device's fill, not Array#fill
    await this.target.fill(node.ref, value)

    return `filled ${name}`
  }

  private async fillSecret(target: string, secret: string): Promise<string> {
    if (this.recording?.film !== undefined)
      throw new Error("a video is recording and cannot mask a secret: stop_recording first")

    const { node, name } = await this.targetOf(target)
    const { vault } = this.options
    const value = await vault.reveal(vault.handle(secret))

    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- the device's fill, not Array#fill
    await this.target.fill(node.ref, value)
    this.secretFields.add(identity(node))
    this.secretFilled = true

    return `filled secret "${secret}" into ${name}`
  }

  private async press(key: string, target: string | undefined): Promise<string> {
    if (this.target.pressKey === undefined)
      throw new Error(`this ${deviceName(this.target.platform)} cannot press keys`)

    if (target === undefined) {
      await this.target.pressKey(key)

      return `pressed ${key}`
    }

    const { node, name } = await this.targetOf(target)

    await this.target.tap(node.ref)
    await this.target.pressKey(key)

    return `tapped ${name}, then pressed ${key}`
  }

  private async setChecked(target: string, checked: boolean): Promise<string> {
    const { node, name } = await this.targetOf(target)
    const word = checked ? "checked" : "unchecked"

    if (node.checked === checked) return `${name} is already ${word}`

    await this.target.tap(node.ref)

    return node.checked === undefined
      ? `tapped ${name} (it shows no checked state; the screen below says what it did)`
      : `${word} ${name}`
  }

  private async navigate(to: string): Promise<string> {
    if (to === "back") {
      await this.target.back()

      return "went back"
    }

    if (to === "forward" || to === "reload")
      throw new Error(
        `a device has no ${to}: navigate takes "back", a path of the app (opened by its link scheme) or a full URL`,
      )

    return this.openPath(to)
  }

  private async scroll(
    direction: "up" | "down" | "left" | "right",
    target: string | undefined,
  ): Promise<string> {
    if (this.target.scroll === undefined)
      throw new Error(`this ${deviceName(this.target.platform)} cannot scroll`)

    if (target === undefined) {
      await this.target.scroll(direction)

      return `scrolled ${direction}`
    }

    const { node, name } = await this.targetOf(target)

    if (node.box === undefined) throw new Error(`${name} has no place on the screen to scroll in`)

    await this.target.scroll(direction, node.box)

    return `scrolled ${direction} in ${name}`
  }

  private async tapAt(x: number, y: number): Promise<string> {
    if (this.target.tapAt === undefined)
      throw new Error(`this ${deviceName(this.target.platform)} cannot tap a point`)

    await this.target.tapAt(x, y)

    return `tapped the point ${Math.round(x)},${Math.round(y)}`
  }

  /** Waits for the services behind the app to go quiet, then for two readings in a row to match. */
  private async settle(): Promise<void> {
    await this.options.backend?.quiet(BACKEND_QUIET_MS).catch(() => undefined)

    const deadline = Date.now() + SCREEN_SETTLE_MS
    let before = signature((await this.target.read()).nodes)

    while (Date.now() < deadline) {
      await sleep(SCREEN_POLL_MS)

      const now = signature((await this.target.read()).nodes)

      if (now === before) return
      before = now
    }
  }

  /** The boxes a picture hides: password fields, secret-filled fields, and any secret's value. */
  private hidden(nodes: readonly DeviceNode[]): DeviceBox[] {
    const values = this.options.vault.values().filter((value) => value !== "")
    const shows = (node: DeviceNode) =>
      [node.text, node.name, node.value ?? ""].some((text) =>
        values.some((value) => text.includes(value)),
      )

    return nodes
      .filter((node) => node.password || this.secretFields.has(identity(node)) || shows(node))
      .flatMap((node) => (node.box === undefined ? [] : [node.box]))
  }

  /**
   * A masked PNG of the screen, cut to `within` when given. The screen is read before and after
   * the picture, and what either reading hides is painted over.
   */
  private async shot(within?: DeviceBox): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "danwo-device-shot-"))

    try {
      const file = join(dir, "screen.png")
      const before = (await this.target.read()).nodes

      if (!(await this.target.screenshot(file)))
        throw new Error(`the ${deviceName(this.target.platform)} gave no screenshot`)

      const after = (await this.target.read()).nodes

      return maskedShot(
        await readFile(file),
        [...this.hidden(before), ...this.hidden(after)],
        within,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** The next frame of a recording, numbered and named for what it follows. */
  private async frame(label: string): Promise<void> {
    if (this.recording === undefined) return

    const count = ++this.recording.frames
    const shot = await this.shot().catch(() => undefined)
    const file = join(this.options.recordDir.path, `${String(count).padStart(3, "0")}-${label}.png`)

    if (shot !== undefined) await writeFile(file, shot)
  }

  /** The app's warnings and errors since the last call, as an answer's closing lines. */
  private async events(): Promise<string[]> {
    const logged = (await this.target.logs?.().catch(() => [])) ?? []
    const worth = logged.filter((line) => line.level === "warn" || line.level === "error")
    const lines = worth
      .slice(0, MAX_EVENTS)
      .map((line) => this.options.redact(`app log ${line.level}: ${line.text}`))
    const more = worth.length > MAX_EVENTS ? [`… ${worth.length - MAX_EVENTS} more`] : []

    return lines.length === 0
      ? []
      : ["", "since the last call:", ...[...lines, ...more].map((line) => `  ${line}`)]
  }
}

function changeLines(before: string, tree: string): string[] {
  const change = before === "" ? { kind: "whole" as const } : snapshotChange(before, tree)

  if (change.kind === "same") return ["screen unchanged"]
  if (change.kind === "diff") return ["screen changes (- gone, + new):", ...change.lines]

  return ["screen:", tree]
}
