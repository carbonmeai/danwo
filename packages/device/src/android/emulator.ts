/**
 * The worker's emulator: one already running (by serial, or the one running the asked AVD), or one
 * booted headless for the worker and shut down when it closes. Booting from a saved snapshot of the
 * AVD is faster than a cold boot; the binder redoes what a snapshot cannot keep.
 */
import { spawn } from "node:child_process"

import { Adb, type Exec, execProgram } from "../adb.ts"
import type { AndroidTools } from "../toolchain.ts"

/** Which emulator to use. */
export interface EmulatorOptions {
  /** The AVD to boot (or to find running), e.g. `danwo_spike`. */
  readonly avd?: string
  /** A running device's serial, e.g. `emulator-5554`; used as it is. */
  readonly serial?: string
  /** A snapshot of the AVD to boot from instead of a cold boot. */
  readonly snapshot?: string
  /** The console port to boot on (even, 5554–5682); the first free one by default. */
  readonly port?: number
  /** How long a boot may take. Default 180 s. */
  readonly bootTimeoutMs?: number
}

export interface RunningEmulator {
  readonly adb: Adb
  /** True when this worker booted it, and so shuts it down on close. */
  readonly booted: boolean
  stop(): Promise<void>
}

const FIRST_PORT = 5554
const LAST_PORT = 5682
const BOOT_POLL_MS = 1_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Serials of the emulators adb sees as ready. */
async function runningSerials(tools: AndroidTools, exec: Exec): Promise<string[]> {
  const listing = await exec(tools.adb, ["devices"])

  return listing
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial?.startsWith("emulator-") === true && state === "device")
    .map(([serial]) => serial ?? "")
}

/** The AVD a running emulator was started from. */
async function avdOf(adb: Adb): Promise<string> {
  const answer = await adb.run(["emu", "avd", "name"]).catch(() => "")

  return answer.split("\n")[0]?.trim() ?? ""
}

/** A running emulator matching the options, if there is one. */
async function findRunning(
  tools: AndroidTools,
  options: EmulatorOptions,
  exec: Exec,
): Promise<Adb | undefined> {
  if (options.serial !== undefined) return new Adb(tools.adb, options.serial, exec)

  for (const serial of await runningSerials(tools, exec)) {
    const adb = new Adb(tools.adb, serial, exec)

    if (options.avd === undefined || (await avdOf(adb)) === options.avd) return adb
  }

  return undefined
}

/** Waits for Android to finish booting. */
async function waitForBoot(adb: Adb, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  await adb.waitForDevice(timeoutMs)

  while ((await adb.shell("getprop sys.boot_completed").catch(() => "")) !== "1") {
    if (Date.now() > deadline)
      throw new Error(`${adb.serial} did not finish booting in ${timeoutMs} ms`)

    await sleep(BOOT_POLL_MS)
  }
}

/** The first console port no running emulator uses. */
async function freePort(tools: AndroidTools, exec: Exec): Promise<number> {
  const used = new Set((await runningSerials(tools, exec)).map((serial) => Number(serial.slice(9))))

  for (let port = FIRST_PORT; port <= LAST_PORT; port += 2) {
    if (!used.has(port)) return port
  }

  throw new Error("no free emulator port between 5554 and 5682")
}

/** The emulator's command line: headless, quiet, and never saving over the AVD's snapshots. */
export function bootArgs(avd: string, port: number, snapshot: string | undefined): string[] {
  return [
    "-avd",
    avd,
    "-port",
    String(port),
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-gpu",
    "swiftshader_indirect",
    "-no-snapshot-save",
    ...(snapshot === undefined ? ["-no-snapshot-load"] : ["-snapshot", snapshot]),
  ]
}

/** Boots `options.avd` headless and waits for it. */
async function boot(tools: AndroidTools, options: EmulatorOptions, exec: Exec): Promise<Adb> {
  if (options.avd === undefined) {
    throw new Error("no emulator is running: name an AVD to boot (`avd`), or start one")
  }

  const port = options.port ?? (await freePort(tools, exec))
  const child = spawn(tools.emulator, bootArgs(options.avd, port, options.snapshot), {
    detached: true,
    stdio: "ignore",
  })

  child.unref()

  const adb = new Adb(tools.adb, `emulator-${port}`, exec)

  await waitForBoot(adb, options.bootTimeoutMs ?? 180_000)

  return adb
}

/** The worker's emulator: a running one when it matches, else one booted for the worker. */
export async function useEmulator(
  tools: AndroidTools,
  options: EmulatorOptions,
  exec: Exec = execProgram,
): Promise<RunningEmulator> {
  const running = await findRunning(tools, options, exec)

  if (running !== undefined) {
    await waitForBoot(running, options.bootTimeoutMs ?? 180_000)

    return { adb: running, booted: false, stop: async () => undefined }
  }

  const adb = await boot(tools, options, exec)

  return {
    adb,
    booted: true,
    async stop() {
      await adb.run(["emu", "kill"]).catch(() => undefined)
    },
  }
}
