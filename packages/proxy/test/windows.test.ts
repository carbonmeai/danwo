import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rememberFor } from "../src/listening.ts"
import { writeNodeShim } from "../src/node-env.ts"

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-shim-"))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("the node shim", () => {
  it("is a shell script where a shell runs it", async () => {
    const bin = await writeNodeShim(join(dir, "posix"), "linux")

    expect(existsSync(join(bin, "node"))).toBe(true)
  })

  it("is not written on Windows, which has no shell to run it", async () => {
    const bin = await writeNodeShim(join(dir, "windows"), "win32")

    expect(existsSync(join(bin, "node"))).toBe(false)
  })
})

describe("how long the proxy trusts an answer about a local port", () => {
  it("is a quarter second, so a service that starts is seen at once", () => {
    expect(rememberFor(true, "linux")).toBe(250)
    expect(rememberFor(false, "darwin")).toBe(250)
    expect(rememberFor(true, "win32")).toBe(250)
  })

  it("is longer for a closed port on Windows, where each probe of one waits out its timeout", () => {
    expect(rememberFor(false, "win32")).toBe(2_000)
  })
})
