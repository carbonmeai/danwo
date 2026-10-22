import { describe, expect, it } from "vitest"

import { parseDuration } from "../src/runner/test-command.ts"

describe("--max-duration", () => {
  it("reads hours, minutes, seconds and milliseconds, and a bare number as seconds", () => {
    expect(parseDuration("1h")).toBe(3_600_000)
    expect(parseDuration("20m")).toBe(1_200_000)
    expect(parseDuration("90s")).toBe(90_000)
    expect(parseDuration("1.5m")).toBe(90_000)
    expect(parseDuration("500ms")).toBe(500)
    expect(parseDuration("45")).toBe(45_000)
  })

  it("refuses anything else, and nothing", () => {
    expect(parseDuration("soon")).toBeUndefined()
    expect(parseDuration("10 minutes")).toBeUndefined()
    expect(parseDuration("0s")).toBeUndefined()
  })
})
