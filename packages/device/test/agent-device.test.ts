import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

/** What the mocked agent-device client did, in order. */
const calls: string[] = []
/** How many of the next fills fail as a daemon that stopped answering does. */
const trouble = { fills: 0, busy: 0 }

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

        if (trouble.fills-- > 0) throw new Error("Daemon request timed out")
      },
      press: async () => void calls.push("press"),
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

const { AgentDeviceDriver } = await import("../src/agent-device.ts")

let dir: string | undefined

afterEach(async () => {
  calls.length = 0
  trouble.fills = 0
  trouble.busy = 0
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
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

  it("gives up when the retried call is stuck too", async () => {
    const opened = await driver()

    trouble.fills = 2
    await expect(opened.fill("e5", "x")).rejects.toThrow("Daemon request timed out")
  })

  it("leaves other failures alone", async () => {
    const opened = await driver()

    await opened.tap("e2")
    await expect(opened.screenshot("/nonexistent/x.png")).resolves.toBe(true)
    await opened.close()
    expect(calls).toEqual(["open com.danwo.shopmobile", "press", "close shutdown=false"])
  })
})
