/**
 * A remote Android device reached over adb: a device cloud that exposes adb, a team's own farm, or
 * any `adb connect host:port` target. danwo connects to it (and disconnects at the end only when it
 * made the connection), and never treats it as an emulator: nothing is booted, wiped or sent an
 * emulator console command. The device reaches danwo's proxy through `adb reverse`, so it needs
 * no route to this machine.
 */
import { Adb, type Exec, execProgram } from "../adb.ts"
import type { AndroidTools } from "../toolchain.ts"
import type { RunningEmulator } from "./emulator.ts"

/** The env variable CI sets to point a run at remote devices; it wins over the config's `adb`. */
const ADB_TARGET_ENV = "DANWO_ADB_TARGET"

/**
 * The oldest API level danwo runs on a remote device: Android 7, the first with the network
 * security config an app uses to trust a user CA such as danwo's.
 */
const MIN_REMOTE_API = 24

/** Which remote device to use. */
export interface RemoteOptions {
  /**
   * The device: `host:port` for `adb connect`, or the serial of one adb already sees. A list gives
   * each worker its own (worker n takes the nth). `DANWO_ADB_TARGET` (comma-separated) overrides it.
   */
  readonly adb?: string | readonly string[]
  /** The worker the device is for (0-based), which picks it from a list. */
  readonly worker?: number
  /** How long the device may take to come online after the connect. Default 30 s. */
  readonly connectTimeoutMs?: number
}

/** A remote device in use: adb bound to it, and a way to connect again after adbd restarts. */
export interface RemoteDevice extends RunningEmulator {
  readonly remote: true
  /** Connects again, for after `adb root` restarted adbd and dropped a network connection. */
  reconnect(): Promise<void>
}

const STATE_POLL_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A target list from its text form: comma-separated, blanks dropped. */
function targetList(text: string): string[] {
  return text
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "")
}

/**
 * The remote target for this worker: the env override, else the option; undefined when neither
 * names one (the run then uses an emulator).
 */
export function remoteTarget(
  options: RemoteOptions,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env[ADB_TARGET_ENV]
  const option = options.adb
  const targets =
    fromEnv !== undefined && fromEnv.trim() !== ""
      ? targetList(fromEnv)
      : typeof option === "string"
        ? targetList(option)
        : [...(option ?? [])]

  if (targets.length === 0) return undefined

  const worker = options.worker ?? 0
  const target = targets[worker]

  if (target === undefined) {
    throw new Error(
      `worker ${worker} has no remote device: ${targets.length} adb target${targets.length === 1 ? "" : "s"} for ${worker + 1} workers; name one per worker, or run fewer workers`,
    )
  }

  return target
}

/** Whether `target` is a network address that `adb connect` takes, rather than a serial. */
export function isNetworkTarget(target: string): boolean {
  return /^(\[[\da-f:]+\]|[^\s:[\]]+):\d+$/i.test(target)
}

/** The state `adb devices` lists for `serial` (`device`, `unauthorized`, `offline`), if listed. */
export function stateOf(listing: string, serial: string): string | undefined {
  for (const line of listing.split(/\r?\n/)) {
    const [each, state] = line.trim().split(/\s+/)

    if (each === serial) return state
  }

  return undefined
}

/** The failure `adb connect` printed, if it failed; adb exits 0 on most of them. */
function connectFailure(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((each) => each.trim())
    .find((each) => /^(failed|cannot|unable)|error/i.test(each))

  return line
}

/** The error for a device that never came online, by the state it was last in. */
function offlineError(target: string, state: string | undefined, timeoutMs: number): Error {
  if (state === "unauthorized") {
    return new Error(
      `${target} has not authorized this computer for debugging: accept the prompt on the device, or add this machine's adb key (~/.android/adbkey.pub) to the device or the device cloud`,
    )
  }

  return new Error(
    `${target} is not reachable over adb (${state ?? "not listed"} after ${timeoutMs} ms): check the address, that the device or the cloud session is up, and that its adb port is open to this machine`,
  )
}

/** Connects to `target`, and says whether this call made the connection (adb had none). */
async function connect(adbPath: string, target: string, exec: Exec): Promise<boolean> {
  let output: string

  try {
    output = await exec(adbPath, ["connect", target], { timeoutMs: 30_000 })
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)

    throw new Error(`${target} is not reachable over adb: ${said}`, { cause: error })
  }

  const failure = connectFailure(output)

  /* A device that has not authorized this computer yet is listed anyway; the wait reports it. */
  if (failure !== undefined && !/already connected|authenticate|unauthorized/i.test(output)) {
    throw new Error(`${target} is not reachable over adb: ${failure}`)
  }

  return !/already connected/i.test(output)
}

/** Waits for `target` to be listed as a ready device; a clear error when it never is. */
async function waitOnline(
  adbPath: string,
  target: string,
  exec: Exec,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let state: string | undefined

  for (;;) {
    state = stateOf(await exec(adbPath, ["devices"]), target)

    if (state === "device") return
    if (Date.now() >= deadline) throw offlineError(target, state, timeoutMs)

    await sleep(STATE_POLL_MS)
  }
}

/** The device's API level; an error when it is too old for a user CA. */
async function checkApiLevel(adb: Adb): Promise<void> {
  const answer = await adb.shell("getprop ro.build.version.sdk")
  const level = Number(answer)

  if (!Number.isInteger(level) || answer === "") {
    throw new Error(
      `${adb.serial} did not report its API level (getprop said ${JSON.stringify(answer)})`,
    )
  }

  if (level < MIN_REMOTE_API) {
    throw new Error(
      `${adb.serial} runs API ${level}; danwo needs API ${MIN_REMOTE_API} (Android 7) or newer, the first that lets an app trust a user CA through its network security config`,
    )
  }
}

/**
 * Connects to the remote `target` (when it is a `host:port` adb is not connected to yet), waits for
 * it to be ready, and checks its API level. Stopping it disconnects only a connection it made.
 */
export async function useRemoteDevice(
  tools: Pick<AndroidTools, "adb">,
  target: string,
  options: Pick<RemoteOptions, "connectTimeoutMs"> = {},
  exec: Exec = execProgram,
): Promise<RemoteDevice> {
  const network = isNetworkTarget(target)
  const timeoutMs = options.connectTimeoutMs ?? 30_000
  const connected = network ? await connect(tools.adb, target, exec) : false
  const adb = new Adb(tools.adb, target, exec)

  const disconnect = async () => {
    if (connected) await exec(tools.adb, ["disconnect", target]).catch(() => undefined)
  }

  try {
    await waitOnline(tools.adb, target, exec, timeoutMs)
    await checkApiLevel(adb)
  } catch (error) {
    await disconnect()
    throw error
  }

  return {
    adb,
    booted: false,
    remote: true,
    async reconnect() {
      if (network) await exec(tools.adb, ["connect", target]).catch(() => "")
      await waitOnline(tools.adb, target, exec, timeoutMs)
    },
    stop: disconnect,
  }
}
