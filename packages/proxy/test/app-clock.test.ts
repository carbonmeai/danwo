import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { type Proxy, startProxy } from "../src/index.ts"

const APP = fileURLToPath(new URL("./fixtures/clock-app.ts", import.meta.url))
const DAY = 86_400_000

const Reading = z.object({
  now: z.number(),
  constructed: z.number(),
  isDate: z.boolean(),
  timerMs: z.number(),
})

let proxy: Proxy

beforeAll(async () => {
  proxy = await startProxy({ routes: [] })
})

afterAll(async () => {
  await proxy.stop()
})

/** Starts the clock app under `command` with the proxy's environment; resolves to its port. */
async function startApp(command: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(command, [APP], { env: proxy.env(), stdio: ["ignore", "pipe", "inherit"] })
  const lines = createInterface({ input: child.stdout ?? process.stdin })
  const [line] = await once(lines, "line")

  return { child, port: Number(line) }
}

/** What the app's clock says now, read over a direct (unproxied) request. */
async function read(port: number): Promise<z.infer<typeof Reading>> {
  const response = await fetch(`http://127.0.0.1:${port}/now`)

  return Reading.parse(await response.json())
}

function hasBun(): boolean {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" })

    return true
  } catch {
    return false
  }
}

describe("the app's clock", () => {
  for (const runtime of ["node", ...(hasBun() ? ["bun"] : [])]) {
    it(`runs ${runtime}'s Date ahead by the offset, with timers on real time`, async () => {
      const { child, port } = await startApp(runtime === "node" ? process.execPath : "bun")

      try {
        const before = await read(port)

        expect(Math.abs(before.now - Date.now())).toBeLessThan(2_000)

        await proxy.clock.setOffset(30 * DAY)

        const after = await read(port)

        expect(after.now - Date.now()).toBeGreaterThan(30 * DAY - 2_000)
        expect(after.now - Date.now()).toBeLessThan(30 * DAY + 2_000)
        expect(after.constructed - after.now).toBeLessThan(50)
        expect(after.isDate).toBe(true)
        expect(after.timerMs).toBeGreaterThan(90)
        expect(after.timerMs).toBeLessThan(1_000)

        await proxy.clock.setOffset(0)

        expect(Math.abs((await read(port)).now - Date.now())).toBeLessThan(2_000)
      } finally {
        child.kill()
        await proxy.clock.setOffset(0)
      }
    }, 30_000)
  }

  it("starts new processes at the current offset", async () => {
    await proxy.clock.setOffset(2 * DAY)

    const { child, port } = await startApp(process.execPath)

    try {
      expect((await read(port)).now - Date.now()).toBeGreaterThan(2 * DAY - 2_000)
    } finally {
      child.kill()
      await proxy.clock.setOffset(0)
    }
  }, 30_000)
})
