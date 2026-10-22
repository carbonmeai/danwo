/**
 * How many iOS Simulators this Mac can run side by side, for a config's `workers`: each worker
 * boots its own, and a booted simulator with an app in it takes about 2 GB and a couple of cores.
 * On a Mac without the room (or one already busy) the answer falls back to one worker.
 */
import { availableParallelism, loadavg, totalmem } from "node:os"

/** Options of `iosWorkers`. */
export interface IosWorkersOptions {
  /** At most this many workers. Default 3. */
  readonly max?: number
  /** The machine, as `os` reports it; tests pass their own. */
  readonly machine?: { readonly memoryMb: number; readonly cores: number; readonly load: number }
}

const DEFAULT_MAX = 3
/** What a booted simulator running an app takes, in MB. */
const SIMULATOR_MB = 2048
/** The share of the machine's memory simulators may take. */
const MEMORY_SHARE = 0.5
const CORES_PER_SIMULATOR = 2

/** How many workers, each with its own simulator, fit on this Mac. */
export function iosWorkers(options: IosWorkersOptions = {}): number {
  const machine = options.machine ?? {
    memoryMb: totalmem() / 2 ** 20,
    cores: availableParallelism(),
    load: loadavg()[0] ?? 0,
  }
  const max = options.max ?? DEFAULT_MAX

  if (machine.load >= machine.cores) return 1

  const byMemory = Math.floor((machine.memoryMb * MEMORY_SHARE) / SIMULATOR_MB)
  const byCores = Math.floor(machine.cores / CORES_PER_SIMULATOR)

  return Math.max(1, Math.min(max, byMemory, byCores))
}
