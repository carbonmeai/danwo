import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { fidelityEnvironment, parseEnvLine } from "../src/provider.ts"

describe("reading .env.fidelity", () => {
  it("strips a comment pasted after an unquoted value", () => {
    expect(parseEnvLine("DANWO_FIDELITY_TWILIO_FROM=+15550001111 # the trial number")).toEqual([
      "DANWO_FIDELITY_TWILIO_FROM",
      "+15550001111",
    ])
    expect(parseEnvLine("KEY=value   ")).toEqual(["KEY", "value"])
  })

  it("keeps a # that is part of an unquoted value, and everything inside quotes", () => {
    expect(parseEnvLine("KEY=abc#def")).toEqual(["KEY", "abc#def"])
    expect(parseEnvLine('KEY="a # b" # note')).toEqual(["KEY", "a # b"])
    expect(parseEnvLine("KEY='single # quoted'")).toEqual(["KEY", "single # quoted"])
  })

  it("reads export lines and skips blanks and comment lines", () => {
    expect(parseEnvLine("export KEY=value")).toEqual(["KEY", "value"])
    expect(parseEnvLine("# KEY=value")).toBeUndefined()
    expect(parseEnvLine("")).toBeUndefined()
    expect(parseEnvLine("KEY=")).toEqual(["KEY", ""])
  })

  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    dir = undefined
  })

  it("applies the same rules to the file, with .env.fidelity over .env", () => {
    dir = mkdtempSync(join(tmpdir(), "danwo-env-"))
    writeFileSync(join(dir, ".env"), "ONLY_ENV=a\nBOTH=from-env\n")
    writeFileSync(join(dir, ".env.fidelity"), 'BOTH=from-fidelity # why\nexport QUOTED="x # y"\n')

    const env = fidelityEnvironment(dir)

    expect(env["ONLY_ENV"]).toBe("a")
    expect(env["BOTH"]).toBe("from-fidelity")
    expect(env["QUOTED"]).toBe("x # y")
  })
})
