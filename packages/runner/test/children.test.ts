import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { ownedCount, spawnOwned, stopAll, treeKillCommand } from "../src/support/children.ts"
import { familyScript } from "./fixtures/child-family.ts"

const OWNER = fileURLToPath(new URL("./fixtures/child-owner.ts", import.meta.url))

/** Whether `pid` still runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** Resolves once none of `pids` runs; rejects after `ms`. */
async function allGone(pids: readonly number[], ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms

  while (pids.some(alive)) {
    if (Date.now() > deadline) throw new Error(`still running: ${pids.filter(alive).join(", ")}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** The pids a family script prints. */
function printedPids(child: ChildProcess): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    let out = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString()

      const match = /pids (\d+) (\d+)/.exec(out)

      if (match) resolve([Number(match[1]), Number(match[2])])
    })
    child.once("exit", (code) => reject(new Error(`exited with ${code} before printing its pids`)))
  })
}

const started: ChildProcess[] = []

afterEach(async () => {
  await stopAll(500)
  for (const child of started.splice(0)) child.kill("SIGKILL")
})

describe("owned children", () => {
  it("stops a child together with the grandchild it started", async () => {
    const owned = spawnOwned(process.execPath, ["-e", familyScript()], {
      stdio: ["ignore", "pipe", "ignore"],
    })
    const pids = await printedPids(owned.child)

    await owned.stop()

    await expect(allGone(pids, 1_000)).resolves.toBeUndefined()
    expect(ownedCount()).toBe(0)
  })

  it("stops once however often it is asked", async () => {
    const owned = spawnOwned(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })

    await Promise.all([owned.stop(), owned.stop()])
    await owned.stop()
    await stopAll()

    expect(owned.child.exitCode !== null || owned.child.signalCode !== null).toBe(true)
  })

  it.each(["SIGKILL", "SIGTERM", "SIGINT"] as const)(
    "leaves nothing behind when the owner gets %s",
    async (signal) => {
      const owner = spawn(process.execPath, [OWNER], { stdio: ["ignore", "pipe", "inherit"] })

      started.push(owner)

      const pids = await printedPids(owner)

      owner.kill(signal)

      await expect(allGone([owner.pid ?? 0, ...pids])).resolves.toBeUndefined()
    },
  )
})

describe("on Windows, which has no process groups", () => {
  it("ends a child with its whole tree, forcibly, since console programs ignore a polite close", () => {
    expect(treeKillCommand(4242)).toEqual(["taskkill", ["/T", "/F", "/PID", "4242"]])
  })
})
