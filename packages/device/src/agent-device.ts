/**
 * `DeviceDriver` over agent-device's Node client, in-process. Its daemon always keeps its state in
 * the run's own directory (never `~/.agent-device`), so a stray daemon can never take the session;
 * its update check is off, so a run makes no network calls of its own.
 */
import { mkdir } from "node:fs/promises"

import { type AgentDeviceClient, createAgentDeviceClient } from "agent-device"

import type { DeviceDriver } from "./driver.ts"
import type { DriverNode } from "./tree.ts"

/** Where and on what the driver runs. */
export interface AgentDeviceOptions {
  /** The daemon's state directory; one per run (e.g. under `.danwo/`). */
  readonly stateDir: string
  /** The device's serial, e.g. `emulator-5554`. */
  readonly serial: string
}

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
      session: `danwo-${this.options.serial}`,
    })
    await this.client.apps.open({
      app,
      platform: "android",
      serial: this.options.serial,
      signal: AbortSignal.timeout(OPEN_MS),
    })
  }

  /**
   * Runs one driver call with a deadline. When the daemon stops answering (it timed out, or the
   * call ran past `CALL_MS`), the session is shut down and opened on the app again, and the call is
   * tried once more.
   */
  private async recovering<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await call(AbortSignal.timeout(CALL_MS))
    } catch (error) {
      if (!stuck(error) || this.app === undefined) throw error

      this.recoveries++
      await this.client?.sessions
        .close({ shutdown: true, signal: AbortSignal.timeout(CLOSE_MS) })
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
    await this.recovering((signal) => this.session.interactions.press({ ...target(ref), signal }))
  }

  async fill(ref: string, text: string): Promise<void> {
    await this.recovering((signal) =>
      // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- the driver's fill, not Array#fill
      this.session.interactions.fill({ ...target(ref), text, signal }),
    )
  }

  async screenshot(path: string): Promise<boolean> {
    try {
      await this.session.capture.screenshot({ path })

      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.client?.sessions.close({ shutdown: false }).catch(() => undefined)
    this.client = undefined
  }
}
