/**
 * The worker's emulator: one already running (by serial, or the one running the asked AVD), or one
 * booted headless for the worker and shut down when it closes. Booting from a saved snapshot of the
 * AVD is faster than a cold boot; the binder redoes what a snapshot cannot keep.
 *
 * Workers run side by side on one AVD: worker n has the console port 5554 + 2n (so the serial
 * `emulator-<port>`), and each boot is read-only, which lets several instances share the AVD's
 * disk images and snapshots without writing to them.
 */
import { spawn } from "node:child_process"
import { closeSync, openSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
  /** The console port to boot on (even, 5554–5682); the worker's, else the first free one. */
  readonly port?: number
  /** The worker this emulator is for (0-based): its console port is 5554 + 2 × worker. */
  readonly worker?: number
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

/** Serials of the emulators the adb at `adbPath` sees as ready. */
export async function runningSerials(adbPath: string, exec: Exec): Promise<string[]> {
  const listing = await exec(adbPath, ["devices"])

  return listing
    .split(/\r?\n/)
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

  const port = portOf(options)

  if (port !== undefined) return findOnPort(tools, options, port, exec)

  for (const serial of await runningSerials(tools.adb, exec)) {
    const adb = new Adb(tools.adb, serial, exec)

    if (options.avd === undefined || (await avdOf(adb)) === options.avd) return adb
  }

  return undefined
}

/** The port the options pin: asked for, or the worker's. */
function portOf(options: EmulatorOptions): number | undefined {
  if (options.port !== undefined) return options.port
  if (options.worker === undefined) return undefined

  const port = FIRST_PORT + 2 * options.worker

  if (port > LAST_PORT) throw new Error(`no emulator port for worker ${options.worker}`)

  return port
}

/** The emulator on `port`, when it runs the asked AVD; an error when another AVD holds the port. */
async function findOnPort(
  tools: AndroidTools,
  options: EmulatorOptions,
  port: number,
  exec: Exec,
): Promise<Adb | undefined> {
  const serial = `emulator-${port}`

  if (!(await runningSerials(tools.adb, exec)).includes(serial)) return undefined

  const adb = new Adb(tools.adb, serial, exec)
  const avd = await avdOf(adb)

  if (options.avd !== undefined && avd !== options.avd) {
    throw new Error(`${serial} runs ${avd || "another AVD"}, not ${options.avd}`)
  }

  return adb
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
  const used = new Set(
    (await runningSerials(tools.adb, exec)).map((serial) => Number(serial.slice(9))),
  )

  for (let port = FIRST_PORT; port <= LAST_PORT; port += 2) {
    if (!used.has(port)) return port
  }

  throw new Error("no free emulator port between 5554 and 5682")
}

/**
 * The emulator's command line: headless, quiet, read-only (so other workers can boot the same AVD)
 * and never saving over the AVD's snapshots.
 */
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
    "-read-only",
    "-no-snapshot-save",
    ...(snapshot === undefined ? ["-no-snapshot-load"] : ["-snapshot", snapshot]),
  ]
}

/** Boots `options.avd` headless and waits for it. */
async function boot(tools: AndroidTools, options: EmulatorOptions, exec: Exec): Promise<Adb> {
  if (options.avd === undefined) {
    throw new Error("no emulator is running: name an AVD to boot (`avd`), or start one")
  }

  const port = portOf(options) ?? (await freePort(tools, exec))
  /* A file rather than a pipe: the emulator keeps running after this worker, and the file says why a boot failed. */
  const log = join(tmpdir(), `danwo-emulator-${port}.log`)
  const output = openSync(log, "w")
  const child = spawn(tools.emulator, bootArgs(options.avd, port, options.snapshot), {
    detached: true,
    /* Detached on Windows opens a console window of its own; the emulator needs none. */
    windowsHide: true,
    stdio: ["ignore", output, output],
  })

  closeSync(output)

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code) => {
      const said = readFileSync(log, "utf8")
      const error = said
        .split(/\r?\n/)
        .findLast((line) => line.includes("ERROR"))
        ?.trim()

      reject(
        new Error(
          `the emulator for ${options.avd} on port ${port} exited (${code}) before it booted${error === undefined ? "" : `: ${error}`}`,
        ),
      )
    })
  })
  const adb = new Adb(tools.adb, `emulator-${port}`, exec)

  exited.catch(() => undefined)

  try {
    await Promise.race([waitForBoot(adb, options.bootTimeoutMs ?? 180_000), exited])
  } finally {
    child.removeAllListeners("exit")
    child.unref()
  }

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
