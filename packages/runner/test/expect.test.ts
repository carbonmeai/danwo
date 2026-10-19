import { describe, expect as vitestExpect, it } from "vitest"

import { expect } from "../src/assert/expect.ts"

describe("expect on plain values", () => {
  it("passes a value that matches", () => {
    expect(3).toBeLessThan(5)
  })

  it("prints the message given with the value when the check fails", () => {
    vitestExpect(() => expect(503, "primus /health: database down").toBeLessThan(500)).toThrow(
      /primus \/health: database down/,
    )
  })

  it("fails without a message as before", () => {
    vitestExpect(() => expect(503).toBeLessThan(500)).toThrow(/expected 503 to be less than 500/)
  })
})
