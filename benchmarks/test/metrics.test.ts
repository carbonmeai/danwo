import { describe, expect, it } from "vitest"

import { bugsFrom } from "../app/bugs.ts"
import { matrixMetrics, styleMetrics, type TestOutcome } from "../bench/metrics.ts"
import { type BenchResults, summary } from "../bench/report.ts"

const passed = (scenario: TestOutcome["scenario"], calls = 0, usd = 0): TestOutcome => ({
  scenario,
  status: "passed",
  ms: 1000,
  calls,
  usd,
})

describe("benchmark metrics", () => {
  it("counts passes, gaps, false failures, catches, cost and replay calls for a style", () => {
    const metrics = styleMetrics(
      {
        style: "agent",
        first: [
          passed("signup", 5, 0.03),
          passed("checkout", 3, 0.02),
          { ...passed("products"), status: "failed" },
          { ...passed("newsletter"), status: "skipped", ms: 0 },
        ],
        replay: [passed("signup"), passed("checkout"), passed("products")],
      },
      [
        { bug: "wrong-total", style: "agent", scenario: "checkout", caught: true },
        { bug: "dead-second-click", style: "agent", scenario: "products", caught: false },
        { bug: "wrong-total", style: "locators", scenario: "checkout", caught: true },
      ],
    )

    expect(metrics).toMatchObject({
      scenarios: 4,
      passed: 2,
      skipped: 1,
      falseFailures: 1,
      bugsCaught: 1,
      bugsRun: 2,
      catchRate: 0.5,
      firstRun: { calls: 8, msPerTest: 1000 },
      replay: { calls: 0, passed: 3 },
    })
    expect(metrics.passRate).toBeCloseTo(2 / 3)
    expect(metrics.firstRun.usd).toBeCloseTo(0.05)
  })

  it("counts a provider bug as caught by a failed faulted run or a lint error", () => {
    const metrics = matrixMetrics([
      { bug: null, failed: 0, lintErrors: 0, ms: 1 },
      { bug: "no-dedupe", failed: 1, lintErrors: 0, ms: 1 },
      { bug: "no-verify", failed: 0, lintErrors: 1, ms: 1 },
      { bug: "raw-429", failed: 0, lintErrors: 0, ms: 1 },
    ])

    expect(metrics).toMatchObject({ bugs: 3, caught: 2, falseFailures: 0 })
    expect(metrics.byBug.map((entry) => entry.how)).toEqual([
      "1 faulted run(s) failed",
      "1 lint error(s)",
      "missed",
    ])
  })

  it("writes a markdown summary with a row per style and per provider bug", () => {
    const results: BenchResults = {
      date: "2026-10-18",
      model: "replay",
      live: false,
      wallMs: 61_000,
      styles: [styleMetrics({ style: "locators", first: [passed("signup")] }, [])],
      matrix: matrixMetrics([{ bug: "no-dedupe", failed: 1, lintErrors: 0, ms: 1 }]),
    }
    const text = summary(results)

    expect(text).toContain("| locators | 100% (1/1) | 0 | 0 | – | 0 | $0.0000 | 1000 ms | – |")
    expect(text).toContain("| no-dedupe | caught | 1 faulted run(s) failed |")
    expect(text).toContain("(not live)")
  })
})

describe("planted bugs", () => {
  it("reads the switches and refuses a name that is not a bug", () => {
    expect([...bugsFrom("wrong-total, no-dedupe")]).toEqual(["wrong-total", "no-dedupe"])
    expect(bugsFrom(undefined).size).toBe(0)
    expect(() => bugsFrom("wrong-totl")).toThrow(/unknown benchmark bug "wrong-totl"/)
  })
})
