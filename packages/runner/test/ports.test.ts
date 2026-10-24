import { type ChildProcess, execFile, spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  ephemeralRange,
  freePort,
  type PortRange,
  portPicker,
  rangeOutside,
} from "../src/support/ports.ts"

const run = promisify(execFile)
/** The module as a `file:` URL, which a child's `import()` takes on every platform (not a Windows path). */
const PORTS = new URL("../src/support/ports.ts", import.meta.url).href

let notes: string
const children: ChildProcess[] = []

beforeEach(() => {
  notes = mkdtempSync(join(tmpdir(), "danwo-port-notes-"))
})

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  rmSync(notes, { recursive: true, force: true })
})

/** A process that runs until the test ends, to hold notes under its pid. */
function liveProcess(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })

  children.push(child)

  return child.pid ?? 0
}

/** A range of `size` ports nothing on this machine listens on now. */
async function quietRange(size: number): Promise<PortRange> {
  for (let from = 21_000; from < 32_000; from += size) {
    const range = { from, to: from + size }
    const probes = await Promise.all(
      Array.from({ length: size }, (_, n) => listening(from + n).catch(() => undefined)),
    )

    const open = probes.filter((server) => server !== undefined)

    await Promise.all(open.map(close))
    if (open.length === size) return range
  }

  throw new Error(`no quiet range of ${size} ports`)
}

function listening(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

describe("rangeOutside", () => {
  const preferred = { from: 20_000, to: 32_768 }

  it("keeps the whole range below Linux's and macOS's default ranges", () => {
    expect(rangeOutside(preferred, { from: 32_768, to: 61_000 })).toEqual(preferred)
    expect(rangeOutside(preferred, { from: 49_152, to: 65_536 })).toEqual(preferred)
  })

  it("keeps the wider part a system's range leaves", () => {
    expect(rangeOutside(preferred, { from: 22_000, to: 61_000 })).toEqual({
      from: 20_000,
      to: 22_000,
    })
    expect(rangeOutside(preferred, { from: 10_000, to: 30_000 })).toEqual({
      from: 30_000,
      to: 32_768,
    })
  })

  it("leaves the pick to the system when its range covers almost all of it", () => {
    expect(rangeOutside(preferred, { from: 1_024, to: 65_536 })).toBeUndefined()
    expect(rangeOutside(preferred, { from: 20_500, to: 65_536 })).toBeUndefined()
  })
})

describe("freePort", () => {
  it("names a port outside the range the system hands out, so no port-0 listener takes it", async () => {
    const ephemeral = ephemeralRange()
    const port = await freePort()

    expect(port >= ephemeral.from && port < ephemeral.to).toBe(false)

    /* Nothing that asks the system for a port meanwhile is given this one. */
    const others = await Promise.all(Array.from({ length: 50 }, () => listening(0)))

    expect(others.map((server) => Reflect.get(Object(server.address()), "port"))).not.toContain(
      port,
    )
    await Promise.all(others.map(close))

    const server = await listening(port)

    await close(server)
  })

  it("never names the same port twice in a process", async () => {
    const ports = await Promise.all(Array.from({ length: 40 }, () => freePort()))

    expect(new Set(ports).size).toBe(40)
  })
})

describe("portPicker", () => {
  it("skips a port a running process noted, and takes over one whose process ended", async () => {
    const range = await quietRange(2)
    const ended = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })

    await new Promise((resolve) => ended.once("exit", resolve))
    writeFileSync(join(notes, String(range.from)), String(liveProcess()))
    writeFileSync(join(notes, String(range.from + 1)), String(ended.pid))

    const pick = portPicker({ notes, range })

    await expect(pick()).resolves.toBe(range.from + 1)
    await expect(pick()).rejects.toThrow(`no free port between ${range.from}`)
  })

  it("skips a port something listens on", async () => {
    const range = await quietRange(2)
    const busy = await listening(range.from)

    try {
      const pick = portPicker({ notes, range })

      await expect(pick()).resolves.toBe(range.from + 1)
    } finally {
      await close(busy)
    }
  })

  it("never names one port to two processes picking at once", async () => {
    const range = await quietRange(24)
    const script = `
      const { portPicker } = await import(${JSON.stringify(PORTS)})
      const pick = portPicker({ notes: ${JSON.stringify(notes)}, range: ${JSON.stringify(range)} })
      const ports = await Promise.all(Array.from({ length: 6 }, () => pick()))
      console.log(JSON.stringify(ports))
      /* Alive while the others pick, so its notes stand. */
      await new Promise((resolve) => setTimeout(resolve, 3000))
    `
    const picked = await Promise.all(
      Array.from({ length: 4 }, () =>
        run(process.execPath, ["--input-type=module", "-e", script]).then(({ stdout }): number[] =>
          JSON.parse(stdout.trim().split("\n")[0] ?? "[]"),
        ),
      ),
    )
    const all = picked.flat()

    expect(all).toHaveLength(24)
    expect(new Set(all).size).toBe(24)
  })
})
