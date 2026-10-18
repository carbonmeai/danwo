import { describe, expect, it } from "vitest"

import { runBench } from "../bench/run.ts"

/*
 * The whole benchmark without a model: the locator suite on the correct app, every planted UI bug,
 * the agent and mixed suites replayed from their committed recordings, and `danwo matrix` with one
 * provider bug (all five take a few minutes more).
 */
describe("the benchmark, not live", () => {
  it("passes the correct app, catches the planted bugs and replays recordings with no model", async () => {
    const results = await runBench({
      live: false,
      model: "replay",
      matrixBugs: ["no-dedupe", "raw-429"],
      out: "",
    })
    const locators = results.styles.find((style) => style.style === "locators")

    expect(locators).toMatchObject({
      scenarios: 11,
      passed: 10,
      skipped: 1,
      falseFailures: 0,
      bugsRun: 4,
      bugsCaught: 4,
      firstRun: { calls: 0 },
    })

    for (const style of results.styles.filter((s) => s.style !== "locators")) {
      expect(style.replay?.calls, `${style.style} replays with no model`).toBe(0)
      expect(style.falseFailures, `${style.style} replays without a false failure`).toBe(0)
    }

    expect(results.matrix).toMatchObject({ bugs: 2, caught: 2, falseFailures: 0 })
  }, 900_000)
})
