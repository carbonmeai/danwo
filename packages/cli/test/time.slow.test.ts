import { execFile } from "node:child_process"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const TRIAL = fileURLToPath(new URL("./fixtures/trial-app", import.meta.url))
const TEST = "tests/trial.danwo.ts"

/** Runs `danwo <args>` under Node in the trial app, with `bug` set; resolves to exit code and output. */
function danwo(args: readonly string[], bug?: string): Promise<{ code: number; out: string }> {
  const env = { ...process.env, NO_COLOR: "1", ...(bug !== undefined && { TRIAL_BUG: bug }) }

  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: TRIAL, env }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

      resolve({ code, out: `${stdout}${stderr}` })
    })
  })
}

afterAll(async () => {
  await rm(join(TRIAL, ".danwo"), { recursive: true, force: true })
})

describe("time travel on a subscription app", () => {
  it("runs 55 days of trial, renewal and a failing card in seconds, with no lint findings", async () => {
    const { code, out } = await danwo(["test"])

    expect(out).toContain("1 passed")
    expect(out).not.toContain("integration lint")
    expect(code).toBe(0)
  })

  it("catches an app that keeps access after the plan ends", async () => {
    const { code, out } = await danwo(["test"], "forever")

    expect(out).toContain('expect(getByTestId("access")).toHaveText("Access: revoked") failed')
    expect(out).toContain('received: "Access: granted"')
    expect(code).toBe(1)
  })

  it("faults the webhooks that fall due after travelling, and a careful app passes them all", async () => {
    const { code, out } = await danwo(["matrix", TEST])

    expect(out).toContain("PASS  duplicate on bachs webhook invoice.paid")
    expect(out).toContain("PASS  duplicate on bachs webhook customer.subscription.deleted")
    expect(out).toMatch(/faults: \d+ passed\n/)
    expect(code).toBe(0)
  })

  it("catches a second receipt for one renewal when Bachs sends invoice.paid twice", async () => {
    const { code, out } = await danwo(["matrix", TEST], "no-dedupe")

    expect(out).toContain("FAIL  duplicate on bachs webhook invoice.paid")
    expect(out).toContain("invariant: expected 2 to be less than or equal to 1")
    expect(out).toMatch(/faults: \d+ passed, 1 failed/)
    expect(code).toBe(1)
  })
})
