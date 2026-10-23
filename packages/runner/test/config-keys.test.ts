import { describe, expect, it } from "vitest"

import { closestKey, configWarnings } from "../src/runner/config-keys.ts"
import { suiteOf } from "../src/runner/reporting.ts"

describe("config keys danwo does not know", () => {
  it("are each named, with the key they most likely mean", () => {
    expect(
      configWarnings({ retires: 2, testmatch: ["*.ts"], workers: 2, matrix: { budjet: 9 } }),
    ).toEqual([
      "unknown config key `retires` (did you mean `retries`?); danwo ignores it",
      "unknown config key `testmatch` (did you mean `testMatch`?); danwo ignores it",
      "unknown config key `matrix.budjet` (did you mean `matrix.budget`?); danwo ignores it",
    ])
  })

  it("get no guess when nothing is close", () => {
    expect(configWarnings({ colour: "blue" })).toEqual([
      "unknown config key `colour`; danwo ignores it",
    ])
    expect(closestKey("environmnet", ["environment", "effects"])).toBe("environment")
    expect(closestKey("x", ["timeout"])).toBeUndefined()
  })

  it("leave a config of known keys alone", () => {
    expect(
      configWarnings({ testDir: "tests", retries: 1, lint: false, matrix: { races: false } }),
    ).toEqual([])
  })
})

describe("the suite's name", () => {
  it("is --name, else the config's name, else none, so one suite reports as before", () => {
    expect(configWarnings({ name: "dashboard" })).toEqual([])
    expect(suiteOf("website", { name: "dashboard" })).toEqual({ suite: "website" })
    expect(suiteOf(undefined, { name: " dashboard " })).toEqual({ suite: "dashboard" })
    expect(suiteOf(undefined, {})).toEqual({})
    expect(suiteOf("", {})).toEqual({})
  })
})
