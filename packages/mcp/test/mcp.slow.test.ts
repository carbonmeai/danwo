import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { connect, PANTRY, resultOf, textOf } from "./client.ts"

const SHOP = fileURLToPath(new URL("../../../examples/shop", import.meta.url))
const DANWO = fileURLToPath(new URL("../../cli/bin/danwo.mjs", import.meta.url))
const LONG = { timeout: 280_000, resetTimeoutOnProgress: true }

describe("running and explaining tests", () => {
  let client: Client
  let failingRecord: string

  beforeAll(async () => {
    client = await connect(PANTRY)
  })

  afterAll(async () => {
    await client.close()
  })

  it("runs the tests, streams progress, and explains the failure", async () => {
    const progress: string[] = []
    const result = await client.callTool(
      { name: "run_tests", arguments: { files: ["basket"] } },
      CallToolResultSchema,
      { ...LONG, onprogress: (p) => progress.push(p.message ?? "") },
    )
    const report = textOf(result)

    expect(report).toMatch(/^1 passed · 1 failed · 0 flaky · 0 skipped in /)
    expect(report).toContain(
      "✓ tests/basket.danwo.ts › adds oats to the basket (1 attempt, 0 model calls)",
    )
    expect(report).toContain("✗ tests/basket.danwo.ts › checks out (1 attempt, 0 model calls)")
    failingRecord = /record: (\S+) \(show_run/.exec(report)?.[1] ?? ""
    expect(failingRecord).toMatch(/^\.danwo\/runs\//)
    expect(report).toContain(
      'failing step: #1 getByRole("heading", name: "Order placed") toBeVisible() tests/basket.danwo.ts:11',
    )
    expect(report).toContain("error EXPECTATION_FAILED:")
    expect(report).toMatch(/report: \.danwo\/runs\/[^/]+\/report\.html/)
    expect(progress.some((line) => line.includes("checks out"))).toBe(true)
  })

  it("narrows a run to named tests", async () => {
    const report = textOf(
      await client.callTool(
        { name: "run_tests", arguments: { tests: ["lists the pantry"] } },
        CallToolResultSchema,
        LONG,
      ),
    )

    expect(report).toMatch(/^1 passed · 0 failed/)
    expect(report).toContain("✓ tests/pantry.danwo.ts › lists the pantry")
  })

  it("shows the failed run's timeline", async () => {
    const run = failingRecord.split("/")[2] ?? ""
    const shown = textOf(await client.callTool({ name: "show_run", arguments: { run } }))

    expect(shown).toMatch(/^run \S+: 2 records, 1 failed/)
    expect(shown).toContain("✗ tests/basket.danwo.ts › checks out · attempt 1 · failed")
    expect(shown).toContain(`record: ${failingRecord}`)
    expect(shown).toContain("(at tests/basket.danwo.ts:11)")
    expect(shown).toContain("screen at failure:")
    expect(shown).toContain('screenshot: read_screenshot with step "failure"')
    expect(shown).toContain("steps (2):\n  #0 ✓ /basket")
    expect(shown).toMatch(
      / {2}#1 ✗ getByRole\("heading", name: "Order placed"\) toBeVisible\(\) \(tests\/basket\.danwo\.ts:11, \d+ ms, screenshot\)/,
    )

    const page = textOf(
      await client.callTool({ name: "show_run", arguments: { run, format: "md" } }),
    )

    expect(page).toContain("EXPECTATION_FAILED")
    expect(page).toContain("tests/basket.danwo.ts:11")
    expect(page).toContain(`record: ${failingRecord}`)

    const newest = textOf(await client.callTool({ name: "show_run", arguments: {} }))

    expect(newest).toMatch(/^run \S+: \d+ records, 0 failed/)
    expect(newest).toContain("every recorded run passed")
  })

  it("returns a screenshot as an image", async () => {
    const result = resultOf(
      await client.callTool({ name: "read_screenshot", arguments: { record: failingRecord } }),
    )
    const [image] = result.content

    expect(result.isError).toBeFalsy()
    expect(image?.type).toBe("image")
    expect(image?.type === "image" && image.mimeType).toBe("image/png")
    expect(
      image?.type === "image" && Buffer.from(image.data, "base64").subarray(1, 4).toString(),
    ).toBe("PNG")

    const step = resultOf(
      await client.callTool({
        name: "read_screenshot",
        arguments: { record: failingRecord, step: 0 },
      }),
    )

    expect(step.content[0]?.type).toBe("image")

    const missing = resultOf(
      await client.callTool({
        name: "read_screenshot",
        arguments: { record: failingRecord, step: 9 },
      }),
    )

    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toContain("step #9 of")
  })

  it("inspects a page and tries locators on it, with secrets redacted", async () => {
    const page = textOf(
      await client.callTool(
        {
          name: "inspect_page",
          arguments: { path: "/", locator: { by: "role", value: "link", name: "oats" } },
        },
        CallToolResultSchema,
        LONG,
      ),
    )

    expect(page).toContain("title: Pantry")
    expect(page).toContain('heading "Pantry"')
    expect(page).toContain('screen.getByRole("link", { name: "oats" }) matches 1 element')
    expect(page).toContain("[secret pantryKey]")
    expect(page).not.toContain("pantry-key-0f9a8b7c6d5e")
    expect(page).not.toMatch(/\[ref=e\d+\]/)

    const many = textOf(
      await client.callTool(
        { name: "inspect_page", arguments: { locator: { by: "role", value: "listitem" } } },
        CallToolResultSchema,
        LONG,
      ),
    )

    expect(many).toContain(
      'screen.getByRole("listitem") matches 2 elements (a locator that clicks or fills must match exactly one)',
    )
  })

  it("stops a run when the call is cancelled", async () => {
    const controller = new AbortController()
    const started = Date.now()
    const call = client.callTool({ name: "run_tests", arguments: {} }, CallToolResultSchema, {
      ...LONG,
      signal: controller.signal,
      onprogress: () => controller.abort(),
    })

    await expect(call).rejects.toThrow(/abort|cancel/i)
    expect(Date.now() - started).toBeLessThan(30_000)

    const after = textOf(
      await client.callTool(
        { name: "run_tests", arguments: { tests: ["lists the pantry"] } },
        CallToolResultSchema,
        LONG,
      ),
    )

    expect(after).toMatch(/^1 passed/)
  })
})

describe("danwo mcp", () => {
  it("serves the project over stdio", async () => {
    const client = new Client({ name: "danwo-test", version: "0.0.0" })

    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [DANWO, "mcp"], cwd: PANTRY }),
    )

    try {
      const listed = textOf(await client.callTool({ name: "list_tests", arguments: {} }))

      expect(listed).toContain("4 tests under")
    } finally {
      await client.close()
    }
  })
})

describe("run_matrix", () => {
  it("runs the faults a filter selects and reports their verdicts", async () => {
    const client = await connect(SHOP)

    try {
      const report = textOf(
        await client.callTool(
          {
            name: "run_matrix",
            arguments: { file: "tests/buy-credits.danwo.ts", faults: "^duplicate" },
          },
          CallToolResultSchema,
          LONG,
        ),
      )

      expect(report).toMatch(
        /^matrix tests\/buy-credits\.danwo\.ts › buys 500 credits through Stripe Checkout: 1 passed · 0 failed · 0 invalid · 0 environment errors in /,
      )
      expect(report).toContain("✓ clean run")
      expect(report).toContain("✓ duplicate on webhook checkout.session.completed")
    } finally {
      await client.close()
    }
  })
})
