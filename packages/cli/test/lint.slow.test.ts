import { execFile } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SLOPPY = fileURLToPath(new URL("./fixtures/sloppy-shop", import.meta.url))
const SHOP = fileURLToPath(new URL("../../../examples/shop", import.meta.url))

/** Runs `danwo <args>` under Node in `cwd`; resolves to its exit code and output. */
function danwo(cwd: string, args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

afterAll(async () => {
  for (const dir of [SLOPPY, SHOP]) await rm(join(dir, ".danwo"), { recursive: true, force: true })
})

describe("integration lint", () => {
  it("finds a sloppy shop's risky Stripe usage while its test passes", async () => {
    const { code, out } = await danwo(SLOPPY, ["test", "--record", "always"])

    expect(out).toContain("1 passed")
    expect(out).toContain("integration lint: 2 errors, 1 warning")
    expect(out).toMatch(/error {3}payments\/unconfirmed .+ never confirmed/)
    expect(out).toMatch(
      /error {3}secrets\/key-in-url .+"key" of GET api\.stripe\.com\/v1\/customers/,
    )
    expect(out).toMatch(
      /warning stripe\/idempotency-key {2}POST api\.stripe\.com\/v1\/checkout\/sessions was sent without an Idempotency-Key/,
    )
    expect(out).toContain("at tests/buy.danwo.ts:")
    // Findings warn by default: the run's exit code is the tests'.
    expect(code).toBe(0)
    // The recorded key stays redacted in the finding and the record.
    expect(out).not.toContain("sloppysloppy")

    const again = await danwo(SLOPPY, ["lint"])

    expect(again.out).toContain("linted 1 record")
    expect(again.out).toContain("integration lint: 2 errors, 1 warning")

    const page = await danwo(SLOPPY, ["show", "--format", "md"])

    expect(page.out).not.toContain("sloppysloppy")
  }, 120_000)

  it("skips the lint with --no-lint", async () => {
    const { code, out } = await danwo(SLOPPY, ["test", "--no-lint"])

    expect(out).toContain("1 passed")
    expect(out).not.toContain("integration lint")
    expect(code).toBe(0)
  }, 120_000)

  it("finds nothing in the shop example, test or matrix", async () => {
    const test = await danwo(SHOP, ["test"])
    const matrix = await danwo(SHOP, ["matrix", "tests/buy-credits.danwo.ts"])

    expect(test.out).toContain("2 passed")
    expect(test.out).not.toContain("integration lint")
    expect(matrix.out).toContain("faults: 15 passed")
    expect(matrix.out).not.toContain("integration lint")
  }, 300_000)

  it("writes findings into the record, readable by the report", async () => {
    await danwo(SLOPPY, ["test", "--record", "always"])

    const { out } = await danwo(SLOPPY, ["show"])
    const html = await readFile(join(SLOPPY, out.trim()), "utf8")

    expect(html).toContain("Integration lint")
    expect(html).toContain("stripe/idempotency-key")
  }, 120_000)
})
