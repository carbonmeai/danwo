/**
 * Filming an iOS Simulator's screen with `simctl io recordVideo`: it writes the film on the Mac
 * while the attempt runs and finishes the file when interrupted. H.264, so every browser plays it.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { existsSync } from "node:fs"

import type { ScreenFilm } from "@danwo/runner/runner"

import { exited } from "../exited.ts"
import type { Spawn } from "./app.ts"
import type { SimulatorTool } from "./simctl.ts"

const spawnProgram: Spawn = (file, args) =>
  spawn(file, [...args], { stdio: ["ignore", "ignore", "pipe"] })

/** How long the first frame may take to arrive, and the film to be finished once interrupted. */
const START_MS = 5_000
const FINISH_MS = 15_000

/** Resolves once simctl says the first frame is in (`Recording started`), or after `ms`. */
function started(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)

    const done = () => {
      clearTimeout(timer)
      resolve()
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("Recording started")) done()
    })
    child.once("exit", done)
  })
}

/** Starts filming the simulator's screen into `path`; `stop()` finishes the file. */
export async function filmSimulator(
  tool: SimulatorTool,
  path: string,
  start: Spawn = spawnProgram,
): Promise<ScreenFilm> {
  const child = start("xcrun", [
    "simctl",
    "io",
    tool.udid,
    "recordVideo",
    "--codec=h264",
    "--force",
    path,
  ])

  child.on("error", () => undefined)
  await started(child, START_MS)

  const startedAt = Date.now()

  return {
    startedAt,
    async stop() {
      if (child.exitCode !== null) return false

      /* Interrupted, recordVideo writes the end of the film before it exits. */
      child.kill("SIGINT")
      await exited(child, FINISH_MS)

      if (child.exitCode === null && child.signalCode === null) {
        child.kill()

        return false
      }

      return existsSync(path)
    },
  }
}
