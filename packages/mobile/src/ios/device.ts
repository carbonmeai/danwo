/**
 * An iOS Simulator ready for a worker's tests: booted (or found running), bound to the run's proxy
 * and CA, the app installed, and the driver's session open. It is the `DeviceTarget` the runner
 * opens each attempt on, and the `device` fixture tests use for what only a device has.
 *
 * The driver measures the screen in points; screenshots, boxes and the agent's marks are in
 * pixels. Readings are scaled to pixels here, and taps and swipes back to points, so the runner
 * sees one unit on both platforms.
 */
import { join } from "node:path"

import type { Proxy } from "@danwo/proxy"
import type {
  DeviceBox,
  DeviceForeground,
  DeviceScreenReading,
  DeviceStart,
  DeviceSwipe,
  DeviceTarget,
  LongPressOptions,
  ScreenFilm,
  ScrollDirection,
} from "@danwo/runner/runner"

import { type Exec, execProgram } from "../adb.ts"
import { AgentDeviceDriver } from "../agent-device.ts"
import { LONG_PRESS_MS, swipeFor, swipePath } from "../android/device.ts"
import { browserPage } from "../browser-page.ts"
import type { DeviceDriver } from "../driver.ts"
import { deviceNodes, type DriverNode } from "../tree.ts"
import { IosApp, type IosAppOptions } from "./app.ts"
import { IosBinder } from "./binder.ts"
import { proxyHelper, SimulatorProxy } from "./proxy-helper.ts"
import { filmSimulator } from "./screen-film.ts"
import { type RunningSimulator, type SimulatorOptions, useSimulator } from "./simulator.ts"
import { browserShowing, iosNodes } from "./tree.ts"

/** Options of `iosDevice`. */
export interface IosDeviceOptions extends SimulatorOptions {
  /** The app under test. */
  readonly app: IosAppOptions & {
    /** Its link scheme, for `app.open(path)` (e.g. `danwoshop`). */
    readonly scheme?: string
  }
  /** The run's proxy: the simulator's traffic goes through it, trusting its CA. */
  readonly proxy: Pick<Proxy, "url" | "caCert" | "exchanges">
  /** Where the driver keeps its state; `.danwo/device/<udid>` under the working directory by default. */
  readonly stateDir?: string
  /** Runs simctl and Xcode's tools; tests pass a fake. */
  readonly exec?: Exec
  /** The driver; agent-device by default. */
  readonly driver?: (udid: string, stateDir: string) => DeviceDriver
  /** The proxy helper program; built with Xcode on first use by default. */
  readonly proxyHelper?: string
}

/** What a browser over the app is called when it is in front. */
const SAFARI_VIEW = "com.apple.SafariViewService"

/** What the driver says when the keyboard covers the element to tap. */
const KEYBOARD_IN_THE_WAY = /behind the visible keyboard/

/** How long a failed screen reading is tried again, and the pause between tries. */
const READ_RETRY_MS = 5_000
const READ_PAUSE_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The driver's handle for `node`. */
function refOf(node: DriverNode): string {
  return node.ref ?? `e${node.index + 1}`
}

/** The element in `nodes` that is `node` from an earlier reading: the same type, label and id. */
export function sameNode(nodes: readonly DriverNode[], node: DriverNode): DriverNode | undefined {
  return nodes.find(
    (each) =>
      each.type === node.type && each.label === node.label && each.identifier === node.identifier,
  )
}

/** An iOS Simulator a worker's tests run on. */
export class IosDevice implements DeviceTarget {
  readonly platform = "ios"
  private readonly simulator: RunningSimulator
  private readonly binder: IosBinder
  private readonly application: IosApp
  private readonly driver: DeviceDriver
  private readonly options: IosDeviceOptions
  /** The screen's size in pixels, from the latest reading. */
  private screen: DeviceBox | undefined
  /** The driver's latest tree, as it gave it. */
  private latest: readonly DriverNode[] = []

  constructor(parts: {
    readonly simulator: RunningSimulator
    readonly binder: IosBinder
    readonly app: IosApp
    readonly driver: DeviceDriver
    readonly options: IosDeviceOptions
  }) {
    this.simulator = parts.simulator
    this.binder = parts.binder
    this.application = parts.app
    this.driver = parts.driver
    this.options = parts.options
  }

  get app(): string {
    return this.application.bundleId
  }

  get scheme(): string | undefined {
    return this.options.app.scheme
  }

  /** The simulator's udid. */
  // fallow-ignore-next-line unused-class-member -- the `device` fixture's, for tests
  get udid(): string {
    return this.simulator.tool.udid
  }

  private get scale(): number {
    return this.simulator.scale
  }

  /** The proxy setting again (the simulator may have dropped it), then the app afresh. */
  async startApp(): Promise<DeviceStart> {
    await this.binder.ensure()

    return this.application.start()
  }

  openLink(url: string): Promise<void> {
    return this.application.openLink(url)
  }

  /** The driver's tree; tried again briefly while one app hands over to another. */
  private async snapshot(): Promise<readonly DriverNode[]> {
    const deadline = Date.now() + READ_RETRY_MS

    for (;;) {
      try {
        this.latest = await this.driver.snapshot()

        return this.latest
      } catch (error) {
        if (Date.now() >= deadline) throw error

        await sleep(READ_PAUSE_MS)
      }
    }
  }

  async read(): Promise<DeviceScreenReading> {
    const nodes = deviceNodes(iosNodes(await this.snapshot(), this.scale))
    const root = nodes.find((node) => node.parent === undefined)?.box

    if (root !== undefined) this.screen = root

    return { nodes }
  }

  /**
   * What is in front: the app, or a Safari view or sign-in session it opened, told by the
   * browser's own controls in the tree, with the page the proxy saw it load.
   */
  async foreground(): Promise<DeviceForeground> {
    if (!browserShowing(await this.snapshot())) return { package: this.app, browser: false }

    const url = browserPage(this.options.proxy)

    return { package: SAFARI_VIEW, browser: true, ...(url !== undefined && { url }) }
  }

  /**
   * Taps the element. One the keyboard covers (a Pay button under a card field just filled) is
   * tapped once the keyboard is put away, as a person would.
   */
  async tap(ref: string): Promise<void> {
    try {
      await this.driver.tap(ref)
    } catch (error) {
      if (!KEYBOARD_IN_THE_WAY.test(String(error)) || this.driver.dismissKeyboard === undefined)
        throw error

      /* Putting the keyboard away ends the reading's refs: tap the same element in a new one. */
      const before = this.latest.find((node) => refOf(node) === ref)

      await this.driver.dismissKeyboard()

      const again = before === undefined ? undefined : sameNode(await this.snapshot(), before)

      if (again === undefined) throw error

      await this.driver.tap(refOf(again))
    }
  }

  fill(ref: string, text: string): Promise<void> {
    return this.driver.fill(ref, text)
  }

  async back(): Promise<void> {
    if (this.driver.back === undefined) throw new Error("this iOS driver cannot go back")

    await this.driver.back()
  }

  async scroll(direction: ScrollDirection, within?: DeviceBox): Promise<void> {
    if (this.driver.swipe === undefined) throw new Error("this iOS driver cannot swipe")

    if (within === undefined && this.screen === undefined) await this.read()

    const box = within ?? this.screen

    if (box === undefined) throw new Error("the simulator's screen size is not known yet")

    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = swipeFor(box, direction).map(
      (pixels) => pixels / this.scale,
    )

    await this.driver.swipe({ x: x1, y: y1 }, { x: x2, y: y2 })
  }

  /** A swipe in points; one with a duration takes that long, the driver's quick swipe otherwise. */
  async swipe(swipe: DeviceSwipe): Promise<void> {
    if (this.driver.swipe === undefined) throw new Error("this iOS driver cannot swipe")

    const whole = "from" in swipe || swipe.within !== undefined ? undefined : await this.screenBox()
    const [from, to] = swipePath(swipe, whole ?? { x: 0, y: 0, width: 0, height: 0 })
    const points = (point: { readonly x: number; readonly y: number }) => ({
      x: point.x / this.scale,
      y: point.y / this.scale,
    })

    await this.driver.swipe(points(from), points(to), swipe.durationMs)
  }

  async longPress(ref: string, options: LongPressOptions = {}): Promise<void> {
    if (this.driver.longPress === undefined) throw new Error("this iOS driver cannot long-press")

    await this.driver.longPress(ref, options.durationMs ?? LONG_PRESS_MS)
  }

  async dismissKeyboard(): Promise<void> {
    if (this.driver.dismissKeyboard === undefined)
      throw new Error("this iOS driver cannot put the keyboard away")

    await this.driver.dismissKeyboard()
  }

  /** The whole screen in pixels, from the latest reading (read now when there is none). */
  private async screenBox(): Promise<DeviceBox> {
    if (this.screen === undefined) await this.read()
    if (this.screen === undefined) throw new Error("the simulator's screen size is not known yet")

    return this.screen
  }

  /** Enter (or Return) presses the keyboard's return key; iOS has no other keys to press. */
  async pressKey(key: string): Promise<void> {
    const name = key.toLowerCase()

    if (name !== "enter" && name !== "return")
      throw new Error(`iOS has no ${JSON.stringify(key)} key to press; only Enter`)
    if (this.driver.pressEnter === undefined) throw new Error("this iOS driver cannot press keys")

    await this.driver.pressEnter()
  }

  async tapAt(x: number, y: number): Promise<void> {
    if (this.driver.tapAt === undefined) throw new Error("this iOS driver cannot tap a point")

    await this.driver.tapAt(x / this.scale, y / this.scale)
  }

  async typeText(text: string): Promise<void> {
    if (this.driver.type === undefined) throw new Error("this iOS driver cannot type")

    await this.driver.type(text)
  }

  /** A PNG of the screen from simctl, which does not queue behind the driver; the driver's when simctl fails. */
  async screenshot(path: string): Promise<boolean> {
    try {
      await this.simulator.tool.on("io", ["screenshot", "--type=png", path])

      return true
    } catch {
      return this.driver.screenshot(path)
    }
  }

  logs(): ReturnType<IosApp["logs"]> {
    return this.application.logs()
  }

  /** Films the screen with simctl, written to `path` when stopped. */
  recordScreen(path: string): Promise<ScreenFilm | undefined> {
    return filmSimulator(this.simulator.tool, path)
  }

  /** Redoes what a simulator reboot lost: the proxy setting, and this run's CA. */
  // fallow-ignore-next-line unused-class-member -- the `device` fixture's, for tests
  rebind(): Promise<void> {
    return this.binder.rebind()
  }

  /** Ends the driver's session, puts the simulator's proxy back, and shuts down a simulator it booted. */
  async close(): Promise<void> {
    await this.driver.close()
    this.application.close()
    await this.binder.unbind()
    await this.simulator.stop()
  }
}

/** Boots (or finds) the simulator, binds it to the proxy, installs the app and opens the driver. */
export async function iosDevice(options: IosDeviceOptions): Promise<IosDevice> {
  const exec = options.exec ?? execProgram
  const simulator = await useSimulator(options, exec)
  const { tool } = simulator
  let binder: IosBinder | undefined

  try {
    const helper = options.proxyHelper ?? (await proxyHelper(tool))

    binder = new IosBinder(tool, new SimulatorProxy(tool, helper), {
      caCert: options.proxy.caCert,
      proxyPort: Number(new URL(options.proxy.url).port),
    })
    await binder.bind()

    const app = new IosApp(tool, options.app, exec)

    await app.install()

    const stateDir = options.stateDir ?? join(process.cwd(), ".danwo", "device", tool.udid)
    const driver =
      options.driver?.(tool.udid, stateDir) ?? new AgentDeviceDriver({ stateDir, udid: tool.udid })

    await driver.open(app.bundleId)

    return new IosDevice({ simulator, binder, app, driver, options })
  } catch (error) {
    await binder?.unbind()
    await simulator.stop()
    throw error
  }
}
