import { describe, expect, it } from "vitest"

import { clientOf, taggedUserAgent, userField, userOf } from "../src/clients.ts"
import { debugging } from "../src/debug.ts"

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

describe("debug output", () => {
  it("names the topics DANWO_DEBUG asks for", () => {
    expect(debugging("proxy", "proxy")).toBe(true)
    expect(debugging("proxy", "runner, proxy")).toBe(true)
    expect(debugging("proxy", "*")).toBe(true)
    expect(debugging("proxy", "runner")).toBe(false)
    expect(debugging("proxy", undefined)).toBe(false)
  })
})
