import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

/** What the mocked agent-device client did, in order. */
const calls: string[] = []
/** How many of the next fills fail as a daemon that stopped answering does. */
const trouble = { fills: 0, busy: 0, message: "Daemon request timed out" }

vi.mock("agent-device", () => ({
  createAgentDeviceClient: () => ({
    apps: {
      open: async ({ app, platform, udid }: { app: string; platform: string; udid?: string }) =>
        void calls.push(platform === "ios" ? `open ${app} on ${udid}` : `open ${app}`),
    },
    sessions: {
      close: async ({ shutdown }: { shutdown?: boolean }) =>
        void calls.push(`close shutdown=${shutdown}`),
    },
    interactions: {
      fill: async () => {
        calls.push("fill")

        if (trouble.fills-- > 0) throw new Error(trouble.message)
      },
      press: async () => void calls.push("press"),
      swipe: async () => void calls.push("swipe"),
      pan: async ({ x, y, dx, dy, durationMs }: Record<string, number>) =>
        void calls.push(`pan ${x},${y} by ${dx},${dy} in ${durationMs}`),
      longPress: async ({ ref, durationMs }: { ref: string; durationMs: number }) =>
        void calls.push(`longpress ${ref} ${durationMs}`),
    },
    capture: {
      snapshot: async () => {
        calls.push("snapshot")

        if (trouble.busy-- > 0)
          throw new Error(
            "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
          )

        return { nodes: [] }
      },
      screenshot: async () => undefined,
    },
  }),
}))

const { AgentDeviceDriver, stopDaemon } = await import("../src/agent-device.ts")

let dir: string | undefined

afterEach(async () => {
  calls.length = 0
  trouble.fills = 0
  trouble.busy = 0
  trouble.message = "Daemon request timed out"
  if (dir !== undefined)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function driver() {
  dir = await mkdtemp(join(tmpdir(), "danwo-driver-"))

  const opened = new AgentDeviceDriver({ stateDir: dir, serial: "emulator-5554" })

  await opened.open("com.danwo.shopmobile")

  return opened
}

describe("the agent-device driver", () => {
  it("shuts a session the daemon stopped answering, opens it again and retries the call once", async () => {
    const opened = await driver()

    trouble.fills = 1
    await opened.fill("e5", "buyer@example.com")

    expect(calls).toEqual([
      "open com.danwo.shopmobile",
      "fill",
      "close shutdown=false",
      "open com.danwo.shopmobile",
      "fill",
    ])
    expect(opened.recoveries).toBe(1)
  })

  it("opens an iOS Simulator by its udid, and waits while its runner finishes an earlier command", async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-driver-"))

    const opened = new AgentDeviceDriver({ stateDir: dir, udid: "SIM-1" })

    await opened.open("com.danwo.shopmobile")
    trouble.busy = 2
    await expect(opened.snapshot()).resolves.toEqual([])
    expect(calls).toEqual([
      "open com.danwo.shopmobile on SIM-1",
      "snapshot",
      "snapshot",
      "snapshot",
    ])
    expect(opened.recoveries).toBe(0)
  })

  it("restarts the session when the iOS runner's main-thread watchdog fired", async () => {
    const opened = await driver()

    trouble.fills = 1
    trouble.message = "main thread execution timed out"
    await opened.fill("e5", "x")
    expect(opened.recoveries).toBe(1)
  })

  it("gives up when the retried call is stuck too", async () => {
    const opened = await driver()

    trouble.fills = 2
    await expect(opened.fill("e5", "x")).rejects.toThrow("Daemon request timed out")
  })

  it("swipes for a duration as a pan, and long-presses by ref", async () => {
    const opened = await driver()

    await opened.swipe({ x: 10, y: 20 }, { x: 10, y: 220 })
    await opened.swipe({ x: 10, y: 20 }, { x: 110, y: 20 }, 600)
    await opened.longPress("e4", 900)
    expect(calls.slice(1)).toEqual(["swipe", "pan 10,20 by 100,0 in 600", "longpress @e4 900"])
  })

  it("leaves other failures alone", async () => {
    const opened = await driver()

    await opened.tap("e2")
    await expect(opened.screenshot("/nonexistent/x.png")).resolves.toBe(true)
    await opened.close()
    expect(calls).toEqual(["open com.danwo.shopmobile", "press", "close shutdown=false"])
  })
})

describe("the driver's daemon", () => {
  it("is stopped when it keeps its state in the driver's directory, and only then", async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-daemon-"))

    const daemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })
    const exited = new Promise((resolve) => daemon.once("exit", resolve))
    const pid = daemon.pid ?? 0

    try {
      await writeFile(join(dir, "daemon.json"), JSON.stringify({ pid, stateDir: "/elsewhere" }))
      await stopDaemon(dir)
      expect(daemon.exitCode).toBeNull()

      await writeFile(join(dir, "daemon.json"), JSON.stringify({ pid, stateDir: dir }))
      await stopDaemon(dir)

      /* Windows has no SIGTERM: it ends the daemon outright, with exit code 1 and no signal. */
      const ended =
        process.platform === "win32" ? { code: 1, signal: null } : { code: null, signal: "SIGTERM" }

      expect({ code: await exited, signal: daemon.signalCode }).toEqual(ended)
    } finally {
      daemon.kill()
    }
  })
})
