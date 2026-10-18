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

/** A ref as agent-device addresses it. */
function target(ref: string): { readonly ref: string } {
  return { ref: ref.startsWith("@") ? ref : `@${ref}` }
}

/** A device driven through agent-device. */
export class AgentDeviceDriver implements DeviceDriver {
  private client: AgentDeviceClient | undefined
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
    this.client = createAgentDeviceClient({
      stateDir: this.options.stateDir,
      session: `danwo-${this.options.serial}`,
    })
    await this.client.apps.open({ app, platform: "android", serial: this.options.serial })
  }

  async snapshot(): Promise<readonly DriverNode[]> {
    const result = await this.session.capture.snapshot({ forceFull: true })

    return result.nodes
  }

  async tap(ref: string): Promise<void> {
    await this.session.interactions.press(target(ref))
  }

  async fill(ref: string, text: string): Promise<void> {
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- the driver's fill, not Array#fill
    await this.session.interactions.fill({ ...target(ref), text })
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
