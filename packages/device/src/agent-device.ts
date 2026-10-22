/**
 * `DeviceDriver` over agent-device's Node client, in-process. Its daemon always keeps its state in
 * the run's own directory (never `~/.agent-device`), so a stray daemon can never take the session;
 * its update check is off, so a run makes no network calls of its own. Actions skip the driver's own
 * wait for the screen to settle: the runner waits for the app and its services after every action.
 * Closing the driver stops that daemon, so a run leaves nothing running.
 */
import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { type AgentDeviceClient, createAgentDeviceClient } from "agent-device"

import type { DeviceDriver, Point } from "./driver.ts"
import type { DriverNode } from "./tree.ts"

/** Where and on what the driver runs: an Android device by its serial, or an iOS Simulator by its udid. */
export type AgentDeviceOptions = {
  /** The daemon's state directory; one per run (e.g. under `.danwo/`). */
  readonly stateDir: string
} & (
  | {
      /** The Android device's serial, e.g. `emulator-5554`. */
      readonly serial: string
    }
  | {
      /** The iOS Simulator's udid. */
      readonly udid: string
    }
)

/** How long opening the session, one call, and shutting a stuck session down may take. */
const OPEN_MS = 120_000
const CALL_MS = 60_000
const CLOSE_MS = 10_000

/** Whether `error` says the daemon stopped answering: its own timeout, or our deadline. */
function stuck(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /Daemon request timed out|request_canceled/.test(error.message)
  )
}

/** Whether `error` says the iOS runner is still finishing an earlier command. */
function busy(error: unknown): boolean {
  return error instanceof Error && /still finishing a previous command/.test(error.message)
}

/** How long a busy iOS runner is waited for, and the pause between tries. */
const BUSY_MS = 30_000
const BUSY_PAUSE_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A ref as agent-device addresses it. */
function target(ref: string): { readonly ref: string } {
  return { ref: ref.startsWith("@") ? ref : `@${ref}` }
}

/** A device driven through agent-device. */
export class AgentDeviceDriver implements DeviceDriver {
  private client: AgentDeviceClient | undefined
  private app: string | undefined
  /** How many times a stuck session was shut down and opened again. */
  recoveries = 0
  private readonly options: AgentDeviceOptions

  constructor(options: AgentDeviceOptions) {
    this.options = options
  }

  private get session(): AgentDeviceClient {
    if (this.client === undefined) throw new Error("the device driver is not open")

    return this.client
  }

  async open(app: string): Promise<void> {
    await mkdir(this.options.stateDir, { recursive: true })
    process.env.AGENT_DEVICE_NO_UPDATE_NOTIFIER = "1"
    this.app = app
    this.client = createAgentDeviceClient({
      stateDir: this.options.stateDir,
      session: `danwo-${"serial" in this.options ? this.options.serial : this.options.udid}`,
    })
    await this.client.apps.open({
      app,
      ...("serial" in this.options
        ? { platform: "android", serial: this.options.serial }
        : { platform: "ios", udid: this.options.udid }),
      signal: AbortSignal.timeout(OPEN_MS),
    })
  }

  /**
   * Runs one driver call, trying it again while the iOS runner says it is still busy with an
   * earlier one (a slow capture past its watchdog finishes on its own), up to `BUSY_MS`.
   */
  private async waitingOutBusy<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const deadline = Date.now() + BUSY_MS

    for (;;) {
      try {
        return await call(AbortSignal.timeout(CALL_MS))
      } catch (error) {
        if (!busy(error) || Date.now() >= deadline) throw error

        await sleep(BUSY_PAUSE_MS)
      }
    }
  }

  /**
   * Runs one driver call with a deadline. When the daemon stops answering (it timed out, or the
   * call ran past `CALL_MS`), the session is shut down and opened on the app again, and the call is
   * tried once more.
   */
  private async recovering<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await this.waitingOutBusy(call)
    } catch (error) {
      if (!stuck(error) || this.app === undefined) throw error

      this.recoveries++
      await this.client?.sessions
        .close({ shutdown: false, signal: AbortSignal.timeout(CLOSE_MS) })
        .catch(() => undefined)
      await this.open(this.app)

      return call(AbortSignal.timeout(CALL_MS))
    }
  }

  async snapshot(): Promise<readonly DriverNode[]> {
    const result = await this.recovering((signal) =>
      this.session.capture.snapshot({ forceFull: true, signal }),
    )

    return result.nodes
  }

  async tap(ref: string): Promise<void> {
    await this.recovering((signal) =>
      this.session.interactions.press({ ...target(ref), settle: false, signal }),
    )
  }

  async fill(ref: string, text: string): Promise<void> {
    await this.recovering((signal) =>
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- the driver's fill, not Array#fill
      this.session.interactions.fill({ ...target(ref), text, settle: false, signal }),
    )
  }

  async type(text: string): Promise<void> {
    await this.recovering((signal) => this.session.interactions.type({ text, signal }))
  }

  async tapAt(x: number, y: number): Promise<void> {
    await this.recovering((signal) =>
      this.session.interactions.press({ x, y, settle: false, signal }),
    )
  }

  async swipe(from: Point, to: Point): Promise<void> {
    await this.recovering((signal) => this.session.interactions.swipe({ from, to, signal }))
  }

  async back(): Promise<void> {
    await this.recovering((signal) => this.session.command.back({ signal }))
  }

  async pressEnter(): Promise<void> {
    await this.recovering((signal) => this.session.command.keyboard({ action: "enter", signal }))
  }

  async dismissKeyboard(): Promise<void> {
    await this.recovering((signal) => this.session.command.keyboard({ action: "dismiss", signal }))
  }

  async screenshot(path: string): Promise<boolean> {
    try {
      await this.session.capture.screenshot({ path })

      return true
    } catch {
      return false
    }
  }

  /** Ends the session, then the run's own daemon, which would otherwise idle on for minutes. */
  async close(): Promise<void> {
    await this.client?.sessions.close({ shutdown: false }).catch(() => undefined)
    this.client = undefined
    await stopDaemon(this.options.stateDir)
  }
}

/** How long a stopped daemon may take to release its claims and exit. */
const DAEMON_EXIT_MS = 5_000

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/**
 * Stops the daemon that keeps its state in `stateDir`, the one this driver started: it writes its
 * pid there and exits cleanly on SIGTERM. A daemon for another directory is never touched.
 */
export async function stopDaemon(stateDir: string): Promise<void> {
  const info: unknown = await readFile(join(stateDir, "daemon.json"), "utf8")
    .then((text): unknown => JSON.parse(text))
    .catch(() => undefined)
  const pid = typeof info === "object" && info !== null ? Reflect.get(info, "pid") : undefined
  const dir = typeof info === "object" && info !== null ? Reflect.get(info, "stateDir") : undefined

  if (typeof pid !== "number" || dir !== stateDir || !alive(pid)) return

  process.kill(pid, "SIGTERM")

  const deadline = Date.now() + DAEMON_EXIT_MS

  while (alive(pid) && Date.now() < deadline) await sleep(100)
}
