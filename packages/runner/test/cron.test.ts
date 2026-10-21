import { describe, expect, it } from "vitest"

import { cronDue } from "../src/runner/cron.ts"

const at = (iso: string) => Date.parse(iso)
const HOUR = 60 * 60 * 1000

describe("cron schedules on a time travel", () => {
  it("fires an hourly schedule once the hour turns, not before", () => {
    const from = at("2026-10-21T09:10:00Z")

    expect(cronDue("0 * * * *", from, from + 49 * 60_000)).toBe(false)
    expect(cronDue("0 * * * *", from, from + 50 * 60_000)).toBe(true)
    expect(cronDue("@hourly", from, from + HOUR)).toBe(true)
  })

  it("counts a tick at the end of the jump but not one at its start", () => {
    const nine = at("2026-10-21T09:00:00Z")

    expect(cronDue("0 9 * * *", nine, nine + HOUR)).toBe(false)
    expect(cronDue("0 9 * * *", nine - HOUR, nine)).toBe(true)
  })

  it("reads steps, ranges, lists and names", () => {
    const monday = at("2026-10-19T00:00:00Z")

    expect(cronDue("*/15 * * * *", monday, monday + 14 * 60_000)).toBe(false)
    expect(cronDue("*/15 * * * *", monday, monday + 15 * 60_000)).toBe(true)
    expect(cronDue("30 8 * * mon-fri", monday, monday + 9 * HOUR)).toBe(true)
    expect(cronDue("30 8 * * sat,sun", monday, monday + 4 * 24 * HOUR)).toBe(false)
    expect(cronDue("0 0 1 jan *", monday, monday + 30 * 24 * HOUR)).toBe(false)
    expect(cronDue("0 0 * * 7", monday, monday + 7 * 24 * HOUR)).toBe(true)
  })

  it("fires on either day field when both are restricted", () => {
    /* The 1st of November 2026 is a Sunday; Monday the 26th of October comes first. */
    const from = at("2026-10-24T00:00:00Z")

    expect(cronDue("0 12 1 * 1", from, at("2026-10-26T12:00:00Z"))).toBe(true)
    expect(cronDue("0 12 1 * *", from, at("2026-10-26T12:00:00Z"))).toBe(false)
  })

  it("keeps a schedule in its own time zone", () => {
    /* 09:00 in New York is 13:00 UTC in October. */
    const from = at("2026-10-21T10:00:00Z")

    expect(cronDue("TZ=America/New_York 0 9 * * *", from, at("2026-10-21T12:59:00Z"))).toBe(false)
    expect(cronDue("TZ=America/New_York 0 9 * * *", from, at("2026-10-21T13:00:00Z"))).toBe(true)
  })

  it("never fires a schedule it cannot read", () => {
    const from = at("2026-10-21T00:00:00Z")

    for (const expression of [
      "",
      "* * * *",
      "61 * * * *",
      "*/0 * * * *",
      "TZ=Nowhere/Else * * * * *",
    ])
      expect(cronDue(expression, from, from + 24 * HOUR)).toBe(false)
  })
})
