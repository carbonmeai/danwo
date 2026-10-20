import { afterEach, describe, expect, it, vi } from "vitest"

import { clientOf, taggedUserAgent, userField, userOf } from "../src/clients.ts"
import { debugging, isDroppedClientLine, quietDroppedClients } from "../src/quiet.ts"

const CHROME =
  "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

describe("who sent a request", () => {
  it("tells a browser from a server-side client", () => {
    expect(clientOf(CHROME)).toBe("browser")
    expect(clientOf("node-fetch/3")).toBe("server")
    expect(clientOf(undefined)).toBe("server")
  })

  it("reads the person a browser was opened for from its user agent", () => {
    const bob = taggedUserAgent(CHROME, "bob")

    expect(clientOf(bob)).toBe("browser")
    expect(userOf(bob)).toBe("bob")
    expect(userOf(CHROME)).toBeUndefined()
    expect(userField(bob)).toEqual({ user: "bob" })
    expect(userField(CHROME)).toEqual({})
  })
})

describe("dropped clients", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("knows the library's line for a client that went away", () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })

    expect(isDroppedClientLine(["Response error:", "read ECONNRESET"])).toBe(true)
    expect(isDroppedClientLine(["Response error:", reset])).toBe(true)
    expect(isDroppedClientLine(["Response error:", "write EPIPE"])).toBe(true)
    expect(isDroppedClientLine(["Response error:", "Unexpected token in JSON"])).toBe(false)
    expect(isDroppedClientLine(["read ECONNRESET"])).toBe(false)
  })

  it("keeps those lines out while a proxy runs, and puts console.log back after the last", () => {
    const seen: unknown[][] = []
    const write = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      seen.push(args)
    })
    const first = quietDroppedClients()
    const second = quietDroppedClients()

    console.log("Response error:", "read ECONNRESET")
    console.log("Response error:", "Unexpected end of JSON")
    first()
    console.log("Response error:", "write EPIPE")
    second()

    expect(seen).toEqual([["Response error:", "Unexpected end of JSON"]])
    expect(console.log).toBe(write)
  })

  it("names the topics DANWO_DEBUG asks for", () => {
    expect(debugging("proxy", "proxy")).toBe(true)
    expect(debugging("proxy", "runner, proxy")).toBe(true)
    expect(debugging("proxy", "*")).toBe(true)
    expect(debugging("proxy", "runner")).toBe(false)
    expect(debugging("proxy", undefined)).toBe(false)
  })
})
