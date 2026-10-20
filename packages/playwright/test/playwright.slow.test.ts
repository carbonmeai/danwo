import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { z } from "@danwo/runner/runner"
import { afterAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "../../cli/test/work-copy.ts"

/** Each matrix replays the shop once per planned fault (15 trials); a busy machine needs longer than the default. */
const MATRIX_TIMEOUT = 600_000

const run = promisify(execFile)
const EXAMPLE = workCopy(
  fileURLToPath(new URL("../../../examples/shop-playwright/", import.meta.url)),
)
const BIN = fileURLToPath(new URL("../bin/danwo-playwright.mjs", import.meta.url))
const PLAYWRIGHT = createRequire(join(EXAMPLE, "package.json")).resolve("@playwright/test/cli")

interface Exit {
  readonly code: number
  readonly out: string
}

/** Runs a command in the example; resolves with its exit code and output, whatever the code. */
async function inExample(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Exit> {
  try {
    const { stdout, stderr } = await run(process.execPath, [...args], {
      cwd: EXAMPLE,
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
    })

    return { code: 0, out: stdout + stderr }
  } catch (error) {
    const failed = z
      .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
      .parse(error)

    return { code: failed.code, out: failed.stdout + failed.stderr }
  }
}

const JsonReport = z.object({
  suites: z.array(
    z.object({
      specs: z.array(
        z.object({
          tests: z.array(
            z.object({
              results: z.array(
                z.object({
                  status: z.string(),
                  attachments: z.array(z.object({ name: z.string(), path: z.string().optional() })),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
})

// Every run writes into the fixture's copy; the copies go when the file is done.
afterAll(removeWorkCopies)

describe("@danwo/playwright on the shop", () => {
  it("runs Playwright tests against the shop's emulated Stripe, live faults included", async () => {
    const { code, out } = await inExample([PLAYWRIGHT, "test", "--reporter=line"])

    expect(out).toContain("2 passed")
    expect(code).toBe(0)
  })

  it("attaches a flight record when a test fails", async () => {
    const { code, out } = await inExample(
      [PLAYWRIGHT, "test", "tests/duplicate-webhook.spec.ts", "--reporter=json"],
      { SHOP_BUG: "no-dedupe" },
    )
    const report = JsonReport.parse(JSON.parse(out.slice(out.indexOf("{"))))
    const result = report.suites[0]?.specs[0]?.tests[0]?.results[0]

    expect(code).toBe(1)
    expect(result?.status).toBe("failed")
    expect(result?.attachments.map((a) => a.name)).toContain("danwo flight record")
  })

  it(
    "passes the matrix with the correct shop",
    async () => {
      const { code, out } = await inExample([BIN, "matrix", "tests/buy-credits.spec.ts"])

      expect(out).toContain("clean run passed; 15 of 15 planned faults to run")
      expect(out).toMatch(/^PASS {2}duplicate on webhook checkout\.session\.completed$/m)
      expect(out).toMatch(/^PASS {2}reset-after on POST api\.stripe\.com\/v1\/checkout\/sessions$/m)
      expect(out).toContain("faults: 15 passed")
      expect(code).toBe(0)
    },
    MATRIX_TIMEOUT,
  )

  it(
    "fails the matrix only on the duplicate webhook when the shop does not dedupe",
    async () => {
      const { code, out } = await inExample([BIN, "matrix", "tests/buy-credits.spec.ts"], {
        SHOP_BUG: "no-dedupe",
      })

      expect(out).toMatch(/^FAIL {2}duplicate on webhook checkout\.session\.completed$/m)
      expect(out).toContain(
        "invariant: expect(received).toBe(expected) // Object.is equality · Expected: 500 · Received: 1000",
      )
      expect(out).toMatch(
        /record: test-results\/danwo-matrix\/\d+-duplicate-on-webhook[^\n]*danwo-flight-record\.json/,
      )
      expect(out.match(/^FAIL /gm)).toHaveLength(1)
      expect(out).toContain("faults: 14 passed, 1 failed")
      expect(code).toBe(1)
    },
    MATRIX_TIMEOUT,
  )

  it("runs only the faults --faults selects", async () => {
    const { code, out } = await inExample([
      BIN,
      "matrix",
      "tests/buy-credits.spec.ts",
      "--faults",
      "^forged",
    ])

    expect(out).toContain("clean run passed; 1 of 15 planned faults to run")
    expect(out).toContain("faults: 1 passed")
    expect(code).toBe(0)
  })

  it("refuses a spec that selects more than one test", async () => {
    const { code, out } = await inExample([BIN, "matrix", "tests"])

    expect(out).toContain("the spec ran 2 danwo tests; select exactly one with --grep")
    expect(code).toBe(1)
  })
})
