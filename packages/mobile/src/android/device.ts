/**
 * An Android emulator ready for a worker's tests: booted (or found running), bound to the run's
 * proxy and CA, the app installed, and the driver's session open. It is the `DeviceTarget` the
 * runner opens each attempt on, and the `device` fixture tests use for what only a device has.
 */
import { join } from "node:path"

import type { Proxy } from "@danwo/proxy"
import type {
  DeviceBox,
  DeviceForeground,
  DevicePoint,
  DeviceScreenReading,
  DeviceStart,
  DeviceSwipe,
  DeviceTarget,
  LongPressOptions,
  ScreenFilm,
  ScrollDirection,
} from "@danwo/runner/runner"

import type { Exec } from "../adb.ts"
import { AgentDeviceDriver } from "../agent-device.ts"
import { browserPage } from "../browser-page.ts"
import type { DeviceDriver } from "../driver.ts"
import { type AndroidTools, androidTools } from "../toolchain.ts"
import { deviceNodes } from "../tree.ts"
import { AndroidApp, type AppOptions } from "./app.ts"
import { AndroidBinder } from "./binder.ts"
import { composeNodes } from "./compose.ts"
import { type EmulatorOptions, type RunningEmulator, useEmulator } from "./emulator.ts"
import { filmScreen } from "./screen-film.ts"

/** Options of `androidDevice`. */
export interface AndroidDeviceOptions extends EmulatorOptions {
  /** The app under test. */
  readonly app: AppOptions & {
    /** Its link scheme, for `app.open(path)` (e.g. `danwoshop`). */
    readonly scheme?: string
  }
  /** The run's proxy: the device's traffic goes through it, trusting its CA. */
  readonly proxy: Pick<Proxy, "url" | "caCert" | "exchanges">
  /** Where the driver keeps its state; `.danwo/device/<serial>` under the working directory by default. */
  readonly stateDir?: string
  /** The tools to run; found from `ANDROID_HOME` by default. */
  readonly tools?: AndroidTools
  /** Runs adb and the emulator; tests pass a fake. */
  readonly exec?: Exec
  /** The driver; agent-device by default. */
  readonly driver?: (serial: string, stateDir: string) => DeviceDriver
}

/** How long a failed screen reading is tried again, and the pause between tries. */
const READ_RETRY_MS = 5_000
const READ_PAUSE_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Android key codes by the names tests and the agent use (web key names, mostly). */
const KEY_CODES: Readonly<Record<string, number>> = {
  enter: 66,
  tab: 61,
  backspace: 67,
  delete: 112,
  escape: 111,
  back: 4,
  home: 3,
  space: 62,
  arrowup: 19,
  arrowdown: 20,
  arrowleft: 21,
  arrowright: 22,
  pageup: 92,
  pagedown: 93,
  search: 84,
  menu: 82,
}

/** The key code of `key`, by name (any case) or as a number; undefined for an unknown name. */
export function keyCode(key: string): number | undefined {
  if (/^\d+$/.test(key)) return Number(key)

  return KEY_CODES[key.toLowerCase().replaceAll(/[\s_-]/g, "")]
}

/** How long a scroll's swipe takes: slow enough not to fling the list past what it shows. */
const SWIPE_MS = 350

/**
 * The swipe that scrolls `box` to show more `direction`: the finger runs across the middle half of
 * the box, the other way.
 */
export function swipeFor(box: DeviceBox, direction: ScrollDirection): readonly number[] {
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  const dx = Math.round(box.width / 4)
  const dy = Math.round(box.height / 4)
  const moves: Record<ScrollDirection, readonly number[]> = {
    down: [x, y + dy, x, y - dy],
    up: [x, y - dy, x, y + dy],
    right: [x + dx, y, x - dx, y],
    left: [x - dx, y, x + dx, y],
  }

  return moves[direction]
}

/** How long a swipe takes when it does not say. */
const SWIPE_DEFAULT_MS = 300

/** How long a long press holds when it does not say. */
export const LONG_PRESS_MS = 800

/** The scroll that a finger moving `direction` makes: moving it up scrolls down. */
const SCROLLED_BY: Record<ScrollDirection, ScrollDirection> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
}

/**
 * Where a swipe's finger starts and ends, in screenshot pixels: its own points, or across the
 * middle half of its box (`screen` without one) the way its direction says.
 */
export function swipePath(
  swipe: DeviceSwipe,
  screen: DeviceBox,
): readonly [DevicePoint, DevicePoint] {
  if ("from" in swipe) return [swipe.from, swipe.to]

  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = swipeFor(
    swipe.within ?? screen,
    SCROLLED_BY[swipe.direction],
  )

  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]
}

/** `text` as `adb shell input text` takes it: spaces as %s, the shell's own characters escaped. */
export function inputText(text: string): string {
  return text.replaceAll(/[\\'"`$&|;<>()*?#~!{}[\]]/g, (char) => `\\${char}`).replaceAll(" ", "%s")
}

/** An Android device a worker's tests run on. */
export class AndroidDevice implements DeviceTarget {
  readonly platform = "android"
  private readonly emulator: RunningEmulator
  private readonly binder: AndroidBinder
  private readonly application: AndroidApp
  private readonly driver: DeviceDriver
  private readonly options: AndroidDeviceOptions
  /** Screenshots taken so far, for unique file names on the device. */
  private shots = 0

  constructor(parts: {
    readonly emulator: RunningEmulator
    readonly binder: AndroidBinder
    readonly app: AndroidApp
    readonly driver: DeviceDriver
    readonly options: AndroidDeviceOptions
  }) {
    this.emulator = parts.emulator
    this.binder = parts.binder
    this.application = parts.app
    this.driver = parts.driver
    this.options = parts.options
  }

  get app(): string {
    return this.application.package
  }

  get scheme(): string | undefined {
    return this.options.app.scheme
  }

  /** The device's serial, e.g. `emulator-5554`. */
  // fallow-ignore-next-line unused-class-member -- the `device` fixture's, for tests
  get serial(): string {
    return this.emulator.adb.serial
  }

  startApp(): Promise<DeviceStart> {
    return this.application.start()
  }

  openLink(url: string): Promise<void> {
    return this.application.openLink(url)
  }

  /**
   * Reads the screen. While one app hands over to another (a Custom Tab returning to the app) the
   * driver can find nothing to read for a moment, so a failed reading is tried again briefly.
   */
  async read(): Promise<DeviceScreenReading> {
    const deadline = Date.now() + READ_RETRY_MS

    for (;;) {
      try {
        return { nodes: deviceNodes(composeNodes(await this.driver.snapshot())) }
      } catch (error) {
        if (Date.now() >= deadline) throw error

        await sleep(READ_PAUSE_MS)
      }
    }
  }

  async foreground(): Promise<DeviceForeground> {
    const front = await this.application.foreground()
    const url = front.browser ? browserPage(this.options.proxy) : undefined

    return { ...front, ...(url !== undefined && { url }) }
  }

  tap(ref: string): Promise<void> {
    return this.driver.tap(ref)
  }

  fill(ref: string, text: string): Promise<void> {
    return this.driver.fill(ref, text)
  }

  back(): Promise<void> {
    return this.application.back()
  }

  async scroll(direction: ScrollDirection, within?: DeviceBox): Promise<void> {
    const box = within ?? (await this.screenBox())

    await this.emulator.adb.shell(`input swipe ${swipeFor(box, direction).join(" ")} ${SWIPE_MS}`)
  }

  /** A swipe by adb, which takes its duration as given. */
  async swipe(swipe: DeviceSwipe): Promise<void> {
    const whole = "from" in swipe || swipe.within !== undefined ? undefined : await this.screenBox()
    const [from, to] = swipePath(swipe, whole ?? { x: 0, y: 0, width: 0, height: 0 })
    const points = [from.x, from.y, to.x, to.y].map(Math.round).join(" ")

    await this.emulator.adb.shell(`input swipe ${points} ${swipe.durationMs ?? SWIPE_DEFAULT_MS}`)
  }

  async longPress(ref: string, options: LongPressOptions = {}): Promise<void> {
    if (this.driver.longPress === undefined)
      throw new Error("this Android driver cannot long-press")

    await this.driver.longPress(ref, options.durationMs ?? LONG_PRESS_MS)
  }

  /** Puts the keyboard away when it shows; the driver checks first, so nothing goes back. */
  async dismissKeyboard(): Promise<void> {
    if (this.driver.dismissKeyboard === undefined)
      throw new Error("this Android driver cannot put the keyboard away")

    await this.driver.dismissKeyboard()
  }

  async pressKey(key: string): Promise<void> {
    const code = keyCode(key)

    if (code === undefined) throw new Error(`no Android key is called ${JSON.stringify(key)}`)

    await this.emulator.adb.shell(`input keyevent ${code}`)
  }

  async tapAt(x: number, y: number): Promise<void> {
    await this.emulator.adb.shell(`input tap ${Math.round(x)} ${Math.round(y)}`)
  }

  async typeText(text: string): Promise<void> {
    if (this.driver.type !== undefined) return this.driver.type(text)

    await this.emulator.adb.shell(`input text ${inputText(text)}`)
  }

  /** The whole screen, from `wm size` (the override when one is set). */
  private async screenBox(): Promise<DeviceBox> {
    const size = await this.emulator.adb.shell("wm size")
    const [width, height] = (/(\d+)x(\d+)\s*$/.exec(size) ?? []).slice(1).map(Number)

    return { x: 0, y: 0, width: width ?? 1080, height: height ?? 2220 }
  }

  /**
   * A PNG of the screen, taken by the device and pulled with adb: it does not queue behind the
   * driver's calls, so a step's screenshot never slows the next step's reading. The driver takes
   * it when adb cannot.
   */
  async screenshot(path: string): Promise<boolean> {
    const remote = `/data/local/tmp/danwo-shot-${++this.shots}.png`
    const adb = this.emulator.adb

    try {
      await adb.shell(`screencap -p ${remote}`)
      await adb.run(["pull", remote, path])

      return true
    } catch {
      return this.driver.screenshot(path)
    } finally {
      await adb.shell(`rm -f ${remote}`).catch(() => undefined)
    }
  }

  logs(): ReturnType<AndroidApp["logs"]> {
    return this.application.logs()
  }

  /** Films the screen with the device's own recorder, pulled to `path` when stopped. */
  recordScreen(path: string): Promise<ScreenFilm | undefined> {
    return Promise.resolve(filmScreen(this.emulator.adb, path))
  }

  /** Redoes what an adbd restart, a reboot or a snapshot load lost: root, this run's CA, the proxy route. */
  // fallow-ignore-next-line unused-class-member -- the `device` fixture's, for tests
  rebind(): Promise<void> {
    return this.binder.rebind()
  }

  /** Ends the driver's session, leaves the device's network as it was, and stops an emulator it booted. */
  // fallow-ignore-next-line unused-class-member -- closed by the environment, which closes either platform's device
  async close(): Promise<void> {
    await this.driver.close()
    await this.binder.unbind()
    await this.emulator.stop()
  }
}

/** Boots (or finds) the emulator, binds it to the proxy, installs the app and opens the driver. */
export async function androidDevice(options: AndroidDeviceOptions): Promise<AndroidDevice> {
  const tools = options.tools ?? androidTools()
  const emulator = await useEmulator(tools, options, options.exec)
  const { adb } = emulator
  const binder = new AndroidBinder(adb, {
    caCert: options.proxy.caCert,
    proxyPort: Number(new URL(options.proxy.url).port),
  })

  try {
    await binder.bind()

    const app = new AndroidApp(adb, options.app)

    await app.install()
    if (options.app.scheme !== undefined) await app.claimScheme(options.app.scheme)

    const stateDir = options.stateDir ?? join(process.cwd(), ".danwo", "device", adb.serial)
    const driver =
      options.driver?.(adb.serial, stateDir) ??
      new AgentDeviceDriver({ stateDir, serial: adb.serial })

    await driver.open(app.package)

    return new AndroidDevice({ emulator, binder, app, driver, options })
  } catch (error) {
    await binder.unbind()
    await emulator.stop()
    throw error
  }
}
