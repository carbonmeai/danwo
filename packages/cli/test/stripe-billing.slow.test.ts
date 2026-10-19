import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const PLAN = workCopy(fileURLToPath(new URL("./fixtures/stripe-plan", import.meta.url)))

/** Runs `danwo <args>` under Node in the subscription app; resolves to exit code and output. */
function danwo(args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: PLAN, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

afterAll(removeWorkCopies)

describe("a Stripe subscription app", () => {
  it("subscribes through Checkout, follows the webhooks and sees the renewal a month later", async () => {
    const { code, out } = await danwo(["test"])

    expect(out).toContain("1 passed")
    expect(code).toBe(0)
  })
})
