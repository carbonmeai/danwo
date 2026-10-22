/**
 * `xcrun simctl`, Xcode's tool for the iOS Simulator, bound to one simulator. Every command goes
 * through `exec`, which tests replace with a fake that records the commands, so the binder's and
 * the app's sequences are checked without Xcode.
 */
import { type Exec, execProgram } from "../adb.ts"

/** A simulator as `simctl list devices --json` reports it. */
export interface SimulatorRecord {
  readonly udid: string
  readonly name: string
  readonly state: string
  readonly isAvailable?: boolean
  readonly deviceTypeIdentifier?: string
  /** The runtime it runs, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-5`. */
  readonly runtime: string
}

/** A device type a runtime can run, as `simctl list runtimes --json` reports it. */
export interface DeviceTypeRecord {
  readonly name: string
  readonly identifier: string
  readonly productFamily?: string
  readonly bundlePath?: string
}

/** An installed simulator runtime. */
export interface RuntimeRecord {
  readonly identifier: string
  /** e.g. `iOS 26.5`. */
  readonly name: string
  readonly version: string
  readonly platform?: string
  readonly isAvailable?: boolean
  readonly supportedDeviceTypes?: readonly DeviceTypeRecord[]
}

/** `simctl` on the machine, not yet bound to a simulator. */
export class Simctl {
  private readonly exec: Exec

  constructor(exec: Exec = execProgram) {
    this.exec = exec
  }

  /** `xcrun simctl <args>`. */
  run(
    args: readonly string[],
    options: { readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string>> } = {},
  ): Promise<string> {
    return this.exec("xcrun", ["simctl", ...args], options)
  }

  /** Runs any Xcode tool through `xcrun`, e.g. `swiftc`. */
  xcrun(args: readonly string[], timeoutMs?: number): Promise<string> {
    return this.exec("xcrun", args, { ...(timeoutMs !== undefined && { timeoutMs }) })
  }

  /** Every simulator, with the runtime it runs. */
  async devices(): Promise<SimulatorRecord[]> {
    const listing: unknown = JSON.parse(await this.run(["list", "devices", "--json"]))
    const byRuntime = isRecord(listing) && isRecord(listing.devices) ? listing.devices : {}

    return Object.entries(byRuntime).flatMap(([runtime, devices]) =>
      Array.isArray(devices)
        ? devices.filter(isSimulator).map((device) => ({ ...device, runtime }))
        : [],
    )
  }

  /** The installed runtimes that can run simulators. */
  async runtimes(): Promise<RuntimeRecord[]> {
    const listing: unknown = JSON.parse(await this.run(["list", "runtimes", "--json"]))
    const runtimes = isRecord(listing) && Array.isArray(listing.runtimes) ? listing.runtimes : []

    return runtimes.filter(isRuntime).filter((runtime) => runtime.isAvailable !== false)
  }

  /** Every device type Xcode knows, with the folder its screen size and scale are read from. */
  async deviceTypes(): Promise<DeviceTypeRecord[]> {
    const listing: unknown = JSON.parse(await this.run(["list", "devicetypes", "--json"]))
    const types = isRecord(listing) && Array.isArray(listing.devicetypes) ? listing.devicetypes : []

    return types.filter(isDeviceType)
  }

  /** `simctl` bound to the simulator `udid`. */
  device(udid: string): SimulatorTool {
    return new SimulatorTool(this, udid)
  }
}

/** `simctl` for one simulator. */
export class SimulatorTool {
  readonly simctl: Simctl
  readonly udid: string

  constructor(simctl: Simctl, udid: string) {
    this.simctl = simctl
    this.udid = udid
  }

  /** `simctl <command> <udid> <args>`, the shape almost every subcommand takes. */
  on(
    command: string,
    args: readonly string[] = [],
    options: { readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string>> } = {},
  ): Promise<string> {
    return this.simctl.run([command, this.udid, ...args], options)
  }

  /** Runs a simulator program (built for the simulator) inside it. */
  spawn(program: string, args: readonly string[], timeoutMs?: number): Promise<string> {
    return this.on("spawn", [program, ...args], { ...(timeoutMs !== undefined && { timeoutMs }) })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSimulator(value: unknown): value is Omit<SimulatorRecord, "runtime"> {
  return isRecord(value) && typeof value.udid === "string" && typeof value.name === "string"
}

function isRuntime(value: unknown): value is RuntimeRecord {
  return isRecord(value) && typeof value.identifier === "string" && typeof value.name === "string"
}

function isDeviceType(value: unknown): value is DeviceTypeRecord {
  return isRecord(value) && typeof value.identifier === "string" && typeof value.name === "string"
}
