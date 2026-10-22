/**
 * The app under test on an Android device: installed once per worker, reset to a fresh install's
 * state for each attempt (`pm clear` keeps the device's CA, proxy and driver session, which a
 * snapshot load would not), and its log read back for the flight recorder.
 */
import type { DeviceLogLine, DeviceStart } from "@danwo/runner/runner"

import type { Adb } from "../adb.ts"

/** The app as a test names it. */
export interface AppOptions {
  /** The app's package, e.g. `com.danwo.shopmobile`. */
  readonly package: string
  /** The APK to install; without it the app must already be installed. */
  readonly apk?: string
  /** The activity to launch; the package's launcher activity by default. */
  readonly activity?: string
  /** Runtime permissions granted before each launch. Default: notifications. */
  readonly permissions?: readonly string[]
  /** How long a launched app may take to come to the front before it is launched again. Default 10 s. */
  readonly launchWaitMs?: number
}

const DEFAULT_PERMISSIONS = ["android.permission.POST_NOTIFICATIONS"]
/** How long a launched app may take to come to the front, and how often that is checked. */
const LAUNCH_WAIT_MS = 10_000
const LAUNCH_POLL_MS = 200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const BROWSERS = new Set(["com.android.chrome", "org.chromium.chrome", "com.chrome.beta"])

/** Logcat's priority letters as log levels. */
const LEVELS: Readonly<Record<string, DeviceLogLine["level"]>> = {
  V: "debug",
  D: "debug",
  I: "info",
  W: "warn",
  E: "error",
  F: "error",
}

/** The package and activity in front, from `dumpsys activity activities`. */
export function topActivity(dump: string): { readonly package: string; readonly activity: string } {
  const line = dump.split("\n").find((each) => each.includes("topResumedActivity")) ?? ""
  const component = /\s([\w.]+)\/([\w.$]+)/.exec(line)

  return { package: component?.[1] ?? "", activity: component?.[2] ?? "" }
}

/** Logcat lines (`-v epoch`) newer than `after`, as log lines. */
export function parseLogcat(output: string, after: number): DeviceLogLine[] {
  const lines: DeviceLogLine[] = []

  for (const line of output.split("\n")) {
    const match = /^\s*(\d+\.\d+)\s+\d+\s+\d+\s+([VDIWEF])\s+(.*)$/.exec(line)
    const seconds = Number(match?.[1])

    if (match === null || !(seconds > after)) continue
    lines.push({
      at: new Date(seconds * 1000).toISOString(),
      level: LEVELS[match[2] ?? "I"] ?? "info",
      text: match[3] ?? "",
    })
  }

  return lines
}

/** The app on one device. */
export class AndroidApp {
  private logsAfter = 0
  /** The launcher activity, found once per worker. */
  private component: string | undefined
  private readonly adb: Adb
  readonly options: AppOptions

  constructor(adb: Adb, options: AppOptions) {
    this.adb = adb
    this.options = options
  }

  private get launchWait(): number {
    return this.options.launchWaitMs ?? LAUNCH_WAIT_MS
  }

  get package(): string {
    return this.options.package
  }

  /** Installs the APK (replacing what is there, permissions granted). */
  async install(): Promise<void> {
    if (this.options.apk !== undefined)
      await this.adb.run(["install", "-r", "-g", this.options.apk], 240_000)
  }

  /**
   * Leaves the app the only one that opens `scheme` links: any other app on the device that claims
   * them (an older build under another package, kept in a snapshot) is disabled, or a link back
   * from the browser stops at an "Open with" chooser. Returns the packages it disabled.
   */
  async claimScheme(scheme: string): Promise<string[]> {
    const handlers = await this.adb.shell(
      `cmd package query-activities --brief -a android.intent.action.VIEW -d ${scheme}://`,
    )
    const others = new Set(
      handlers
        .split("\n")
        .map((line) => /^\s*([\w.]+)\/[\w.$]+\s*$/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined && name !== this.package),
    )

    for (const other of others) await this.adb.shell(`pm disable-user --user 0 ${other}`)

    return [...others]
  }

  private async launcher(): Promise<string> {
    if (this.options.activity !== undefined) return `${this.package}/${this.options.activity}`

    this.component ??= await this.resolveLauncher()

    return this.component
  }

  private async resolveLauncher(): Promise<string> {
    const resolved = await this.adb.shell(`cmd package resolve-activity --brief ${this.package}`)
    const component = resolved.split("\n").at(-1)?.trim() ?? ""

    if (!component.includes("/"))
      throw new Error(`${this.package} is not installed or has no launcher`)

    return component
  }

  /**
   * Data cleared, permissions granted, then launched and in front. A browser an earlier attempt
   * left open (a Custom Tab it never came back from) is stopped first, so nothing covers the app.
   * Right after a data clear Android can drop a launch; then the app is stopped and launched once
   * more, and the result says so.
   */
  async start(): Promise<DeviceStart> {
    const launch = `am start -n ${await this.launcher()}`
    /*
     * One shell for the whole reset: each adb round trip costs a few hundred milliseconds on a
     * busy machine. A browser or permission that is not there must not stop the rest.
     */
    const reset = [
      `pm clear ${this.package}`,
      ...[...BROWSERS].map((browser) => `am force-stop ${browser} 2>/dev/null`),
      ...(this.options.permissions ?? DEFAULT_PERMISSIONS).map(
        (permission) => `pm grant ${this.package} ${permission} 2>/dev/null`,
      ),
      "logcat -c",
      /* A crash dialog an earlier attempt left ("Chrome keeps stopping") would cover the app. */
      "am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1",
    ]

    this.logsAfter = Date.now() / 1000
    await this.adb.shell(`${reset.join("; ")}; ${launch}`)

    const first = await this.waitInFront()

    if (first === this.package) return { relaunched: undefined }

    await this.adb.shell(`am force-stop ${this.package}`)
    await this.adb.shell(launch)

    const second = await this.waitInFront()

    if (second !== this.package) {
      throw new Error(
        `${this.package} did not come to the front after two launches (in front: ${second || "nothing"})`,
      )
    }

    return {
      relaunched: `not in front ${this.launchWait} ms after launch (in front: ${first || "nothing"}); stopped and launched again`,
    }
  }

  /** Waits for the app to be the activity in front; the package in front when it gives up. */
  private async waitInFront(): Promise<string> {
    const deadline = Date.now() + this.launchWait
    let front = (await this.foreground()).package

    while (front !== this.package && Date.now() < deadline) {
      await sleep(LAUNCH_POLL_MS)
      front = (await this.foreground()).package
    }

    return front
  }

  /** Opens `url` with the device's handler for it: the app for its own scheme, else the browser. */
  async openLink(url: string): Promise<void> {
    await this.adb.shell(
      `am start -W -a android.intent.action.VIEW -d '${url.replaceAll("'", "%27")}'`,
    )
  }

  /** What is in front: the app, or a browser such as the Custom Tab it opened. */
  async foreground(): Promise<{ readonly package: string; readonly browser: boolean }> {
    const top = topActivity(await this.adb.shell("dumpsys activity activities"))

    return { package: top.package, browser: BROWSERS.has(top.package) }
  }

  /** The app's log since the last call. */
  async logs(): Promise<DeviceLogLine[]> {
    const pid = await this.adb.shell(`pidof ${this.package}`).catch(() => "")

    if (pid === "") return []

    const output = await this.adb.shell(`logcat -d -v epoch --pid=${pid.split(/\s+/)[0] ?? ""}`)
    const lines = parseLogcat(output, this.logsAfter)
    const last = lines.at(-1)

    if (last !== undefined) this.logsAfter = new Date(last.at).getTime() / 1000

    return lines
  }

  /** Presses Back. */
  async back(): Promise<void> {
    await this.adb.shell("input keyevent 4")
  }
}
