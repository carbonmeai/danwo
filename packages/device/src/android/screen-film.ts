/**
 * Filming an Android screen with the device's own `screenrecord`: it writes an MP4 on the device
 * while the attempt runs, finishes the file when interrupted, and the film is pulled with adb. A
 * single film stops by itself after three minutes, the longest `screenrecord` records.
 */
import { type ChildProcess, spawn } from "node:child_process"

import type { ScreenFilm } from "@danwo/runner/runner"

import type { Adb } from "../adb.ts"

/** Starts a program and gives back its process; tests replace it. */
export type Spawn = (file: string, args: readonly string[]) => ChildProcess

const spawnProgram: Spawn = (file, args) => spawn(file, [...args], { stdio: "ignore" })

/** How long `screenrecord` may take to finish its file once interrupted. */
const FINISH_MS = 10_000
/** The longest film `screenrecord` takes, in seconds. */
const TIME_LIMIT_S = 180
/** Enough to read text on a phone screen, small enough to keep many films. */
const BIT_RATE = 2_000_000

/** Resolves once `child` has exited, or after `ms`. */
function exited(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)

    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Starts filming the device's screen; `stop()` pulls the film to `path`. */
export function filmScreen(adb: Adb, path: string, start: Spawn = spawnProgram): ScreenFilm {
  const remote = `/data/local/tmp/danwo-film-${Date.now()}.mp4`
  const startedAt = Date.now()
  const child = start(adb.path, [
    "-s",
    adb.serial,
    "shell",
    "screenrecord",
    "--bit-rate",
    String(BIT_RATE),
    "--time-limit",
    String(TIME_LIMIT_S),
    remote,
  ])

  child.on("error", () => undefined)

  return {
    startedAt,
    async stop() {
      try {
        /* Interrupted, screenrecord writes the end of the file before it exits. */
        await adb.shell("pkill -INT screenrecord").catch(() => undefined)
        await exited(child, FINISH_MS)
        await adb.run(["pull", remote, path])

        return true
      } catch {
        return false
      } finally {
        child.kill()
        await adb.shell(`rm -f ${remote}`).catch(() => undefined)
      }
    },
  }
}
