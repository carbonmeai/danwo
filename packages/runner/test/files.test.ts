import { describe, expect, it } from "vitest"

import { renameOver } from "../src/support/files.ts"

/** The error Windows gives while another process holds the file open. */
const busy = () => Object.assign(new Error("busy"), { code: "EPERM" })

describe("renaming over a file Windows holds open", () => {
  it("retries until the file is free", async () => {
    let calls = 0

    const move = async () => {
      calls += 1
      if (calls < 3) throw busy()
    }

    await renameOver("a.tmp", "a.json", move)

    expect(calls).toBe(3)
  })

  it("gives up after its attempts, and at once on any other error", async () => {
    await expect(renameOver("a", "b", () => Promise.reject(busy()), 2)).rejects.toThrow("busy")

    let calls = 0

    const missing = async () => {
      calls += 1
      throw Object.assign(new Error("gone"), { code: "ENOENT" })
    }

    await expect(renameOver("a", "b", missing)).rejects.toThrow("gone")
    expect(calls).toBe(1)
  })
})
