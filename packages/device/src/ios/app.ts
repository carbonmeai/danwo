/**
 * The app under test on an iOS Simulator: installed once per worker, reset to a fresh install's
 * state for each attempt (its data container emptied, which keeps the simulator's CA, proxy and
 * driver session), launched with its arguments and environment, and its log read back for the
 * flight recorder.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"

import type { DeviceLogLine, DeviceStart } from "@danwo/runner/runner"

import type { Exec } from "../adb.ts"
import type { SimulatorTool } from "./simctl.ts"

/** The app as a test names it. */
export interface IosAppOptions {
  /** The app's bundle id, e.g. `com.danwo.shopmobile`. */
  readonly bundleId: string
  /** The simulator build (`.app` folder) to install; without it the app must already be installed. */
  readonly app?: string
  /** Launch arguments, as the app's `ProcessInfo.arguments` gets them. */
  readonly launchArgs?: readonly string[]
  /** Environment the app is launched with. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Privacy permissions granted before each launch, by `simctl privacy` service name (`photos`,
   * `camera`, `location`…). Notifications cannot be granted this way on the simulator.
   */
  readonly permissions?: readonly string[]
}

/** What the data container holds right after an install; everything else is the app's own data. */
const CONTAINER_METADATA = ".com.apple.mobile_container_manager.metadata.plist"
const CONTAINER_FOLDERS = [
  "Documents",
  "Library/Caches",
  "Library/Preferences",
  "SystemData",
  "tmp",
]

/** Starts a program and gives back its process; tests replace it. */
export type Spawn = (file: string, args: readonly string[]) => ChildProcess

const spawnProgram: Spawn = (file, args) =>
  spawn(file, [...args], { stdio: ["ignore", "pipe", "ignore"] })

/** Unified log message types as log levels. */
const LEVELS: Readonly<Record<string, DeviceLogLine["level"]>> = {
  Debug: "debug",
  Info: "info",
  Default: "info",
  Error: "error",
  Fault: "error",
}

/** One line of `log stream --style ndjson` as a log line, or undefined for anything else. */
export function parseLogLine(line: string): DeviceLogLine | undefined {
  try {
    const entry: unknown = JSON.parse(line)

    if (typeof entry !== "object" || entry === null) return undefined

    const field = (name: string): unknown => Reflect.get(entry, name)
    const message = field("eventMessage")
    const timestamp = field("timestamp")
    const text = typeof message === "string" ? message : undefined
    const at = typeof timestamp === "string" ? new Date(timestamp) : undefined

    if (text === undefined || at === undefined || Number.isNaN(at.getTime())) return undefined

    return {
      at: at.toISOString(),
      level: LEVELS[String(field("messageType"))] ?? "info",
      text,
    }
  } catch {
    return undefined
  }
}

/** `env` as `simctl launch` passes it on: each name prefixed with `SIMCTL_CHILD_`. */
export function childEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [`SIMCTL_CHILD_${name}`, value]),
  )
}

/** The app on one simulator. */
export class IosApp {
  private readonly tool: SimulatorTool
  private readonly exec: Exec
  private readonly spawnLog: Spawn
  readonly options: IosAppOptions
  /** The app's program name, which its log lines carry. */
  private executable: string | undefined
  private stream: ChildProcess | undefined
  private buffered: DeviceLogLine[] = []

  constructor(
    tool: SimulatorTool,
    options: IosAppOptions,
    exec: Exec,
    spawnLog: Spawn = spawnProgram,
  ) {
    this.tool = tool
    this.options = options
    this.exec = exec
    this.spawnLog = spawnLog
  }

  get bundleId(): string {
    return this.options.bundleId
  }

  /** Installs the build, replacing what is there, and notes its program name for the log. */
  async install(): Promise<void> {
    if (this.options.app === undefined) return

    await this.tool.on("install", [this.options.app], { timeoutMs: 240_000 })
    this.executable = (
      await this.exec("plutil", [
        "-extract",
        "CFBundleExecutable",
        "raw",
        join(this.options.app, "Info.plist"),
      ]).catch(() => "")
    ).trim()
  }

  /** Empties the app's data container, as a fresh install has it. */
  private async clearData(): Promise<void> {
    const container = (await this.tool.on("get_app_container", [this.bundleId, "data"])).trim()

    if (container === "" || container === "(null)")
      throw new Error(`${this.bundleId} is not installed on ${this.tool.udid}`)

    for (const entry of await readdir(container)) {
      if (entry !== CONTAINER_METADATA)
        await rm(join(container, entry), { recursive: true, force: true })
    }

    for (const folder of CONTAINER_FOLDERS)
      await mkdir(join(container, folder), { recursive: true })
  }

  /**
   * Stopped, data cleared, permissions granted, then launched with its arguments and environment.
   * Safari is stopped too, so a page an earlier attempt left open never covers the app.
   */
  async start(): Promise<DeviceStart> {
    this.stopLog()
    await this.tool.on("terminate", [this.bundleId]).catch(() => undefined)
    await this.tool.on("terminate", ["com.apple.mobilesafari"]).catch(() => undefined)
    await this.clearData()

    for (const service of this.options.permissions ?? [])
      await this.tool.on("privacy", ["grant", service, this.bundleId])

    this.buffered = []
    this.startLog()
    /* simctl takes its own options before the udid. */
    await this.tool.simctl.run(
      [
        "launch",
        "--terminate-running-process",
        this.tool.udid,
        this.bundleId,
        ...(this.options.launchArgs ?? []),
      ],
      { env: childEnv(this.options.env ?? {}) },
    )

    return { relaunched: undefined }
  }

  /** Opens `url` with the simulator's handler for it: the app for its own scheme, else Safari. */
  async openLink(url: string): Promise<void> {
    await this.tool.on("openurl", [url])
  }

  /** Follows the app's log lines from now on. */
  private startLog(): void {
    if (this.executable === undefined || this.executable === "") return

    const child = this.spawnLog("xcrun", [
      "simctl",
      "spawn",
      this.tool.udid,
      "log",
      "stream",
      "--style",
      "ndjson",
      "--level",
      "default",
      "--predicate",
      `process == "${this.executable}"`,
    ])

    child.on("error", () => undefined)

    if (child.stdout !== null) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        const parsed = parseLogLine(line)

        if (parsed !== undefined) this.buffered.push(parsed)
      })
    }

    this.stream = child
  }

  private stopLog(): void {
    this.stream?.kill()
    this.stream = undefined
  }

  /** The app's log lines since the last call. */
  logs(): Promise<DeviceLogLine[]> {
    const lines = this.buffered

    this.buffered = []

    return Promise.resolve(lines)
  }

  /** Stops following the log. */
  close(): void {
    this.stopLog()
  }
}
