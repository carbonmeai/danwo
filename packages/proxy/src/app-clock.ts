/**
 * The app's clock, as the proxy's preload shifts it. Every process started with the proxy's
 * environment reads a small file holding an offset in milliseconds and adds it to `Date`; timers
 * and `performance.now()` keep running on real time. Shifting by an offset rather than freezing
 * time keeps everything that measures real durations working: sockets, retries, database pools,
 * framework timers. Each process acknowledges a new offset by writing it under the file's ack
 * folder, so a shift resolves only once every live app process has taken it.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

/** The variable that tells the preload where the offset lives. */
export const APP_CLOCK_VARIABLE = "DANWO_TIME_FILE"

/** How long a shift waits for every app process to acknowledge it. */
const ACK_TIMEOUT_MS = 5_000

/** The app's clock: how far ahead of real time it runs, and a way to move it. */
export interface AppClock {
  /** The file the preload reads; children inherit it through `APP_CLOCK_VARIABLE`. */
  readonly file: string
  /** Milliseconds the app's `Date` runs ahead of real time. */
  offset(): number
  /** Sets the offset and resolves once every live app process has taken it. */
  setOffset(ms: number): Promise<void>
}

/** Creates the offset file (at zero) in `dir`. */
export function createAppClock(dir: string): AppClock {
  const file = join(dir, "time-offset")
  const acks = `${file}.acks`
  let offset = 0

  writeFileSync(file, "0")
  mkdirSync(acks, { recursive: true })

  return {
    file,
    offset: () => offset,
    async setOffset(ms) {
      offset = Math.round(ms)
      writeFileSync(file, String(offset))
      await acknowledged(acks, offset)
    },
  }
}

/** Waits until every live process that registered under `acks` reports `offset`. */
async function acknowledged(acks: string, offset: number): Promise<void> {
  const deadline = Date.now() + ACK_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (lagging(acks, offset).length === 0) return
    await sleep(5)
  }

  throw new Error(
    `app processes ${lagging(acks, offset).join(", ")} did not take the new clock offset`,
  )
}

/** Live processes whose acknowledged offset is not `offset`; dead ones are forgotten. */
function lagging(acks: string, offset: number): string[] {
  return readdirSync(acks).filter((pid) => {
    if (!alive(Number(pid))) {
      rmSync(join(acks, pid), { force: true })

      return false
    }

    return readAck(join(acks, pid)) !== offset
  })
}

function readAck(path: string): number | undefined {
  try {
    return Number(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}
