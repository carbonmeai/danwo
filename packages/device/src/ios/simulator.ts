/**
 * The worker's iOS Simulator: one named by its udid, or danwo's own simulator for the worker,
 * found by name or created on first use (an iPhone on the newest iOS runtime unless told
 * otherwise) and kept for later runs. A simulator this worker booted is shut down when it closes;
 * one that was already running is left running.
 *
 * Workers run side by side on their own simulators: worker n uses `<name> <n + 1>` from the second
 * worker on, so no two workers ever share a device.
 */
import { type Exec, execProgram } from "../adb.ts"
import {
  type DeviceTypeRecord,
  type RuntimeRecord,
  Simctl,
  type SimulatorRecord,
  type SimulatorTool,
} from "./simctl.ts"

/** Which simulator to use. */
export interface SimulatorOptions {
  /** A simulator's udid, used as it is (booted if needed, never created or deleted). */
  readonly udid?: string
  /** The simulator's name; created when none has it. Default `danwo iPhone`. */
  readonly name?: string
  /** The runtime to create it on: a name (`iOS 26.5`), a version (`26.5`) or an identifier. Default: the newest iOS. */
  readonly runtime?: string
  /** The device type to create: a name (`iPhone 17 Pro`) or an identifier. Default: the runtime's newest iPhone Pro. */
  readonly deviceType?: string
  /** The worker this simulator is for (0-based): from the second on, its name gets the worker's number. */
  readonly worker?: number
  /** Deletes a simulator this run created when it closes, rather than keeping it for the next run. */
  readonly remove?: boolean
  /** How long a boot may take. Default 180 s. */
  readonly bootTimeoutMs?: number
}

/** A simulator ready for a worker. */
export interface RunningSimulator {
  readonly tool: SimulatorTool
  readonly name: string
  /** Screenshot pixels per point: the device type's screen scale. */
  readonly scale: number
  /** True when this worker booted it, and so shuts it down on close. */
  readonly booted: boolean
  /** True when this worker created it. */
  readonly created: boolean
  stop(): Promise<void>
}

export const DEFAULT_SIMULATOR_NAME = "danwo iPhone"
const DEFAULT_SCALE = 3

/** The worker's simulator name: the base name, numbered from the second worker on. */
export function simulatorName(options: Pick<SimulatorOptions, "name" | "worker">): string {
  const name = options.name ?? DEFAULT_SIMULATOR_NAME

  return options.worker === undefined || options.worker === 0
    ? name
    : `${name} ${options.worker + 1}`
}

/** A runtime's version as numbers, for ordering: `26.5` → [26, 5]. */
function versionOf(runtime: RuntimeRecord): number[] {
  return runtime.version.split(".").map(Number)
}

function newerFirst(a: RuntimeRecord, b: RuntimeRecord): number {
  const [left, right] = [versionOf(a), versionOf(b)]

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (right[i] ?? 0) - (left[i] ?? 0)

    if (difference !== 0) return difference
  }

  return 0
}

/** The iOS runtime `wanted` names (by name, version or identifier), or the newest one. */
export function pickRuntime(
  runtimes: readonly RuntimeRecord[],
  wanted: string | undefined,
): RuntimeRecord {
  const ios = runtimes
    .filter((runtime) => (runtime.platform ?? runtime.name.split(" ")[0]) === "iOS")
    .toSorted(newerFirst)
  const found =
    wanted === undefined
      ? ios[0]
      : ios.find((runtime) => [runtime.name, runtime.version, runtime.identifier].includes(wanted))

  if (found === undefined) {
    const installed = ios.map((runtime) => runtime.name).join(", ") || "none"

    throw new Error(
      wanted === undefined
        ? "no iOS Simulator runtime is installed: add one in Xcode (Settings → Components)"
        : `no iOS runtime ${JSON.stringify(wanted)} is installed (installed: ${installed})`,
    )
  }

  return found
}

/** An iPhone's model number from its name: 17 for `iPhone 17 Pro`, 0 for an `iPhone SE`. */
function generation(type: DeviceTypeRecord): number {
  return Number(/^iPhone (\d+)/.exec(type.name)?.[1] ?? 0)
}

/** The device type `wanted` names on `runtime`, or its newest iPhone (a Pro when there is one). */
export function pickDeviceType(
  runtime: RuntimeRecord,
  wanted: string | undefined,
): DeviceTypeRecord {
  const types = runtime.supportedDeviceTypes ?? []

  if (wanted !== undefined) {
    const found = types.find((type) => type.name === wanted || type.identifier === wanted)

    if (found === undefined)
      throw new Error(`${runtime.name} cannot run a ${JSON.stringify(wanted)} simulator`)

    return found
  }

  /* By model number, newest first: the listing's own order is not promised. */
  const phones = types
    .filter((type) => (type.productFamily ?? type.name).startsWith("iPhone"))
    .toSorted((a, b) => generation(b) - generation(a))
  const found = phones.find((type) => type.name.endsWith(" Pro")) ?? phones[0]

  if (found === undefined) throw new Error(`${runtime.name} has no iPhone device type`)

  return found
}

/** The simulator the options name, if it exists. */
function findExisting(
  devices: readonly SimulatorRecord[],
  options: SimulatorOptions,
  runtime: RuntimeRecord | undefined,
): SimulatorRecord | undefined {
  if (options.udid !== undefined) {
    const device = devices.find((each) => each.udid === options.udid)

    if (device === undefined) throw new Error(`no simulator has the udid ${options.udid}`)

    return device
  }

  const name = simulatorName(options)

  return devices.find(
    (device) =>
      device.name === name &&
      device.isAvailable !== false &&
      (runtime === undefined || device.runtime === runtime.identifier),
  )
}

/** Screenshot pixels per point for the simulator's device type, from its profile. */
async function scaleOf(simctl: Simctl, exec: Exec, device: SimulatorRecord): Promise<number> {
  const types = await simctl.deviceTypes().catch((): DeviceTypeRecord[] => [])
  const type = types.find((each) => each.identifier === device.deviceTypeIdentifier)

  if (type?.bundlePath === undefined) return DEFAULT_SCALE

  const profile = `${type.bundlePath}/Contents/Resources/profile.plist`
  const scale = await exec("plutil", ["-extract", "mainScreenScale", "raw", profile]).catch(
    () => "",
  )

  return Number(scale.trim()) || DEFAULT_SCALE
}

/** The worker's simulator, booted: an existing one when it matches, else one created for danwo. */
export async function useSimulator(
  options: SimulatorOptions,
  exec: Exec = execProgram,
): Promise<RunningSimulator> {
  const simctl = new Simctl(exec)
  const wantsRuntime = options.udid === undefined && options.runtime !== undefined
  const runtime = wantsRuntime ? pickRuntime(await simctl.runtimes(), options.runtime) : undefined
  let device = findExisting(await simctl.devices(), options, runtime)
  let created = false

  if (device === undefined) {
    const on = runtime ?? pickRuntime(await simctl.runtimes(), undefined)
    const type = pickDeviceType(on, options.deviceType)
    const name = simulatorName(options)
    const udid = (await simctl.run(["create", name, type.identifier, on.identifier])).trim()

    created = true
    device = {
      udid,
      name,
      state: "Shutdown",
      runtime: on.identifier,
      deviceTypeIdentifier: type.identifier,
    }
  }

  const tool = simctl.device(device.udid)
  const booted = device.state !== "Booted"

  if (booted) {
    await tool.simctl.run(["boot", device.udid]).catch((error: unknown) => {
      /* Booted meanwhile by someone else: fine, `bootstatus` below waits for it. */
      if (!String(error).includes("current state: Booted")) throw error
    })
  }

  await tool.on("bootstatus", ["-b"], { timeoutMs: options.bootTimeoutMs ?? 180_000 })

  const scale = await scaleOf(simctl, exec, device)
  const { udid, name } = device

  return {
    tool,
    name,
    scale,
    booted,
    created,
    async stop() {
      if (booted) await simctl.run(["shutdown", udid]).catch(() => undefined)
      if (created && options.remove === true)
        await simctl.run(["delete", udid]).catch(() => undefined)
    },
  }
}
