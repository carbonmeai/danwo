/**
 * How many emulators this machine can run side by side, for a config's `workers`: each worker
 * boots its own, and an emulator wants its AVD's RAM and a couple of cores. On a machine without
 * the room (or one already busy) the answer falls back to one worker rather than a run where every
 * emulator crawls.
 */
import { readFileSync } from "node:fs"
import { availableParallelism, homedir, loadavg, totalmem } from "node:os"
import { join } from "node:path"

/** Options of `androidWorkers`. */
export interface AndroidWorkersOptions {
  /** At most this many workers. Default 3. */
  readonly max?: number
  /** The AVD the workers boot; its RAM setting sizes each emulator. */
  readonly avd?: string
  /** The machine, as `os` reports it; tests pass their own. */
  readonly machine?: Machine
}

/** What the count depends on. */
export interface Machine {
  readonly memoryMb: number
  readonly cores: number
  /** The one-minute load average. */
  readonly load: number
  /** An emulator's RAM, in MB. */
  readonly emulatorMb: number
}

const DEFAULT_MAX = 3
/** The AVD RAM assumed when its config cannot be read. */
const DEFAULT_EMULATOR_MB = 2048
/** What an emulator takes beyond its guest RAM: the emulator process, its GPU and disk caches. */
const EMULATOR_OVERHEAD_MB = 1024
/** The share of the machine's memory emulators may take; the rest is for the host, its apps and danwo. */
const MEMORY_SHARE = 0.5
const CORES_PER_EMULATOR = 2

/** The AVD's `hw.ramSize` in MB, from its config. */
function avdRamMb(avd: string | undefined): number {
  if (avd === undefined) return DEFAULT_EMULATOR_MB

  const home = process.env.ANDROID_AVD_HOME ?? join(homedir(), ".android", "avd")

  try {
    const config = readFileSync(join(home, `${avd}.avd`, "config.ini"), "utf8")
    const size = /^hw\.ramSize\s*=\s*(\d+)/m.exec(config)?.[1]

    return size === undefined ? DEFAULT_EMULATOR_MB : Number(size)
  } catch {
    return DEFAULT_EMULATOR_MB
  }
}

/** This machine. */
function thisMachine(avd: string | undefined): Machine {
  return {
    memoryMb: totalmem() / 2 ** 20,
    cores: availableParallelism(),
    load: loadavg()[0] ?? 0,
    emulatorMb: avdRamMb(avd),
  }
}

/**
 * How many workers, each with its own emulator, fit on this machine: no more than `max`, half the
 * memory or a pair of cores per emulator allow, and one when the machine is already loaded past its
 * cores.
 */
export function androidWorkers(options: AndroidWorkersOptions = {}): number {
  const machine = options.machine ?? thisMachine(options.avd)
  const max = options.max ?? DEFAULT_MAX

  if (machine.load >= machine.cores) return 1

  const byMemory = Math.floor(
    (machine.memoryMb * MEMORY_SHARE) / (machine.emulatorMb + EMULATOR_OVERHEAD_MB),
  )
  const byCores = Math.floor(machine.cores / CORES_PER_EMULATOR)

  return Math.max(1, Math.min(max, byMemory, byCores))
}
