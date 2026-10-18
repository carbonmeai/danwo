/**
 * An Android emulator ready for a worker's tests: booted (or found running), bound to the run's
 * proxy and CA, the app installed, and the driver's session open. It is the `DeviceTarget` the
 * runner opens each attempt on, and the `device` fixture tests use for what only a device has.
 */
import { join } from "node:path"

import type { Proxy } from "@danwo/proxy"
import type {
  DeviceForeground,
  DeviceScreenReading,
  DeviceStart,
  DeviceTarget,
} from "@danwo/runner/runner"

import type { Exec } from "../adb.ts"
import { AgentDeviceDriver } from "../agent-device.ts"
import type { DeviceDriver } from "../driver.ts"
import { type AndroidTools, androidTools } from "../toolchain.ts"
import { deviceNodes } from "../tree.ts"
import { AndroidApp, type AppOptions } from "./app.ts"
import { AndroidBinder } from "./binder.ts"
import { type EmulatorOptions, type RunningEmulator, useEmulator } from "./emulator.ts"

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

/** The page a browser in front shows: the newest document the browser fetched through the proxy. */
function browserPage(proxy: AndroidDeviceOptions["proxy"]): string | undefined {
  const page = proxy
    .exchanges()
    .toReversed()
    .find((exchange) => {
      const headers = exchange.request?.headers ?? {}

      return (
        headers["sec-fetch-dest"] === "document" || (headers.accept ?? "").includes("text/html")
      )
    })

  return page === undefined ? undefined : `https://${page.host}${page.path}`
}

/** An Android device a worker's tests run on. */
export class AndroidDevice implements DeviceTarget {
  readonly platform = "android"
  private readonly emulator: RunningEmulator
  private readonly binder: AndroidBinder
  private readonly application: AndroidApp
  private readonly driver: DeviceDriver
  private readonly options: AndroidDeviceOptions

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
        return { nodes: deviceNodes(await this.driver.snapshot()) }
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

  screenshot(path: string): Promise<boolean> {
    return this.driver.screenshot(path)
  }

  logs(): ReturnType<AndroidApp["logs"]> {
    return this.application.logs()
  }

  /** Redoes what an adbd restart, a reboot or a snapshot load lost: root, this run's CA, the proxy route. */
  // fallow-ignore-next-line unused-class-member -- the `device` fixture's, for tests
  rebind(): Promise<void> {
    return this.binder.rebind()
  }

  /** Ends the driver's session, leaves the device's network as it was, and stops an emulator it booted. */
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
