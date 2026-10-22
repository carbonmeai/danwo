import { describe, expect, it } from "vitest"

import { spawnOwned, useTreeSystem } from "../src/support/children.ts"
import {
  endBySignal,
  hasGroups,
  signalLeader,
  signalTree,
  SYSTEM,
  treeAlive,
  treeLeaderOptions,
  type TreeSystem,
} from "../src/support/process-tree.ts"

/** A system on `platform` that records its calls; `alive` holds the pids (or `-pgid`s) that run. */
function fakeSystem(platform: NodeJS.Platform, alive: Set<number> = new Set()) {
  const calls: string[] = []
  const system: TreeSystem = {
    platform,
    kill(pid, signal) {
      calls.push(`kill ${pid} ${signal}`)
      if (!alive.has(pid)) throw Object.assign(new Error("no such process"), { code: "ESRCH" })
    },
    runSync(command, args) {
      calls.push([command, ...args].join(" "))
    },
    exit(code) {
      calls.push(`exit ${code}`)
    },
  }

  return { system, calls }
}

describe("process trees on macOS and Linux", () => {
  it("signals the group the child leads", () => {
    const { system, calls } = fakeSystem("linux", new Set([-42]))

    signalTree(42, "SIGTERM", system)

    expect(calls).toEqual(["kill -42 SIGTERM"])
    expect(treeAlive(42, system)).toBe(true)
    expect(treeAlive(43, system)).toBe(false)
  })

  it("starts a child as a group leader and re-raises a signal on itself", () => {
    const { system, calls } = fakeSystem("darwin", new Set([process.pid]))

    endBySignal("SIGHUP", system)

    expect(calls).toEqual([`kill ${process.pid} SIGHUP`])
    expect(treeLeaderOptions("darwin")).toEqual({ detached: true, windowsHide: true })
    expect(hasGroups("darwin")).toBe(true)
  })

  it("signals a process that leads no group on its own", () => {
    const { system, calls } = fakeSystem("linux", new Set([42]))

    signalLeader(42, "SIGTERM", system)

    expect(calls).toEqual(["kill -42 SIGTERM", "kill 42 SIGTERM"])
  })

  it("takes a vanished group quietly", () => {
    const { system } = fakeSystem("linux")

    expect(() => signalTree(7, "SIGKILL", system)).not.toThrow()
  })
})

describe("process trees on Windows, which has no process groups", () => {
  it("ends the whole tree with taskkill, whatever the signal", () => {
    const { system, calls } = fakeSystem("win32")

    signalTree(4242, "SIGTERM", system)
    signalTree(4242, "SIGKILL", system)

    expect(calls).toEqual(["taskkill /T /F /PID 4242", "taskkill /T /F /PID 4242"])
  })

  it("ends a run's tree with taskkill even when danwo did not start it", () => {
    const { system, calls } = fakeSystem("win32")

    signalLeader(77, "SIGTERM", system)

    expect(calls).toEqual(["taskkill /T /F /PID 77"])
  })

  it("checks the tree's root by its pid, not a group", () => {
    const { system, calls } = fakeSystem("win32", new Set([4242]))

    expect(treeAlive(4242, system)).toBe(true)
    expect(calls).toEqual(["kill 4242 0"])
  })

  it("exits with 128 plus the signal's number, since it cannot signal itself", () => {
    const { system, calls } = fakeSystem("win32")

    endBySignal("SIGINT", system)
    endBySignal("SIGHUP", system)

    expect(calls).toEqual(["exit 130", "exit 129"])
  })

  it("keeps a child on this console, without a window, instead of detaching it", () => {
    expect(treeLeaderOptions("win32")).toEqual({ detached: false, windowsHide: true })
    expect(hasGroups("win32")).toBe(false)
  })

  it("stops an owned child with taskkill on its pid", async () => {
    const { system, calls } = fakeSystem("win32")
    /* taskkill here ends the real child, as it would on Windows. */
    const previous = useTreeSystem({
      ...system,
      kill: (pid, signal) => {
        calls.push(`kill ${pid} ${signal}`)
        process.kill(pid, signal)
      },
      runSync(command, args) {
        system.runSync(command, args)
        process.kill(Number(args.at(-1)), "SIGKILL")
      },
    })

    try {
      const owned = spawnOwned(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      })
      const pid = owned.child.pid ?? 0

      await owned.stop(500)

      expect(calls).toContain(`taskkill /T /F /PID ${pid}`)
      expect(calls).not.toContain(`kill -${pid} SIGTERM`)
      expect(owned.child.exitCode !== null || owned.child.signalCode !== null).toBe(true)
    } finally {
      useTreeSystem(previous)
    }
  })

  it("uses this machine's calls by default", () => {
    expect(SYSTEM.platform).toBe(process.platform)
  })
})
