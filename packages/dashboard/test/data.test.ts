import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { insideArea } from "../src/data/files.ts"
import { getImpact } from "../src/data/impact.ts"
import { getInsights } from "../src/data/insights.ts"
import { getRecord, getScreenshot } from "../src/data/records.ts"
import { getRun, listRuns } from "../src/data/runs.ts"

const NO_USAGE = { cache: {}, spent: { calls: 0, retries: 0, tokens: [0, 0], usd: 0 }, steps: [] }
const SPENT = {
  cache: { replayed: 2, missed: 1 },
  spent: { calls: 3, retries: 0, tokens: [900, 90], usd: 0.03 },
  steps: [],
}
const RECORD_DIR = ".danwo/runs/20261018-100000-aaaa/tests-checkout/attempt-1"
const PNG = Buffer.from("89504e470d0a1a0a", "hex")

let root: string

async function write(path: string, value: unknown): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true })
  await writeFile(join(root, path), typeof value === "string" ? value : JSON.stringify(value))
}

function testRun(id: string, startedAt: string, checkout: string, record?: string) {
  return {
    version: 1,
    kind: "test",
    id,
    startedAt,
    durationMs: 4_000,
    ...(record && { run: id }),
    usage: SPENT,
    tests: [
      {
        id: "tests/checkout.danwo.ts › pays",
        status: checkout,
        attempts: [
          {
            status: checkout === "passed" ? "passed" : "failed",
            durationMs: 3_000,
            usage: SPENT,
            ...(record && {
              record,
              error: { code: "EXPECTATION_FAILED", class: "test", message: "no heading" },
            }),
          },
        ],
      },
      {
        id: "tests/home.danwo.ts › loads",
        status: "passed",
        attempts: [{ status: "passed", durationMs: 500, usage: NO_USAGE }],
      },
    ],
    brokenFiles: [],
  }
}

const MATRIX = {
  version: 1,
  kind: "matrix",
  id: "20261018-110000-bbbb",
  startedAt: "2026-10-18T11:00:00.000Z",
  durationMs: 30_000,
  usage: NO_USAGE,
  testId: "tests/checkout.danwo.ts › pays",
  file: "tests/checkout.danwo.ts",
  clean: { fault: null, target: null, status: "passed", notes: [], calls: 4, deliveries: 1 },
  trials: [
    {
      fault: "duplicate on webhook checkout.session.completed",
      target: "webhook",
      status: "failed",
      notes: [],
      calls: 4,
      deliveries: 2,
    },
    {
      fault: "status 500 on POST api.stripe.com/v1/checkout/sessions",
      target: "outbound",
      status: "passed",
      notes: [],
      calls: 2,
      deliveries: 0,
    },
    {
      fault: "reset on GET api.stripe.com/v1/customers/:id",
      target: "outbound",
      status: "not-judged",
      notes: [],
      calls: 1,
      deliveries: 0,
    },
    {
      fault: "delay 600000ms on webhook invoice.paid",
      target: "webhook",
      status: "invalid",
      notes: [],
      calls: 4,
      deliveries: 0,
    },
  ],
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-dashboard-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("runs", () => {
  it("lists runs newest first with their counts and cost, and pages them", async () => {
    await write(
      ".danwo/history/a.json",
      testRun("20261018-090000-aaaa", "2026-10-18T09:00:00.000Z", "passed"),
    )
    await write(
      ".danwo/history/b.json",
      testRun("20261018-100000-aaaa", "2026-10-18T10:00:00.000Z", "failed", RECORD_DIR),
    )
    await write(".danwo/history/c.json", MATRIX)
    await write(".danwo/history/broken.json", "{ not json")

    const { rows, total } = await listRuns(root)

    expect(total).toBe(3)
    expect(rows.map((row) => row.kind)).toEqual(["matrix", "test", "test"])
    expect(rows[0]?.counts).toMatchObject({ failed: 1, passed: 1, notJudged: 1, invalid: 1 })
    expect(rows[1]).toMatchObject({
      title: "2 tests",
      costUsd: 0.03,
      modelCalls: 3,
      recorded: true,
    })
    expect(rows[1]?.counts).toMatchObject({ passed: 1, failed: 1 })
    expect((await listRuns(root, 1, 2)).rows.map((row) => row.id)).toEqual(["20261018-090000-aaaa"])
  })

  it("finds one run, and none for an id it does not know", async () => {
    await write(".danwo/history/c.json", MATRIX)

    expect((await getRun(root, MATRIX.id))?.kind).toBe("matrix")
    expect(await getRun(root, "nope")).toBeUndefined()
  })

  it("lists nothing for a project that never ran", async () => {
    expect(await listRuns(root)).toEqual({ rows: [], total: 0 })
  })
})

describe("records", () => {
  beforeEach(async () => {
    await write(`${RECORD_DIR}/record.json`, {
      version: 1,
      test: "tests/checkout.danwo.ts › pays",
      run: { kind: "test", attempt: 1 },
      status: "failed",
      error: {
        code: "EXPECTATION_FAILED",
        class: "test",
        name: "AssertionError",
        message: "no heading",
      },
      notes: [],
      startedAt: "2026-10-18T10:00:00.000Z",
      durationMs: 3_000,
      steps: [
        {
          id: "s1",
          index: 1,
          kind: "agent",
          api: "agent.act",
          label: 'act("pay")',
          status: "passed",
          startedAt: "2026-10-18T10:00:01.000Z",
          durationMs: 800,
          source: { file: "tests/checkout.danwo.ts", line: 4 },
          cache: { mode: "diverged", because: "effect" },
          screenshot: "screenshots/001-step-1.png",
          events: [
            {
              kind: "effects",
              at: "2026-10-18T10:00:01.500Z",
              result: "diverged",
              expected: {
                page: { appeared: ['heading "Paid"'], vanished: [] },
                backend: ["POST api.stripe.com/v1/charges"],
              },
              observed: { page: { appeared: [], vanished: [] }, backend: [] },
              reason: "expected POST api.stripe.com/v1/charges, saw none",
            },
          ],
        },
      ],
      appLog: [
        {
          at: "2026-10-18T10:00:02.000Z",
          level: "error",
          source: "console",
          text: "boom",
          step: 1,
        },
      ],
      exchanges: [],
      deliveries: [],
      state: { stripe: { charges: 0 } },
    })
    await write(`${RECORD_DIR}/screenshots/001-step-1.png`, PNG.toString("latin1"))
  })

  it("reads a record with each step's cache outcome, effects and the failure page", async () => {
    const view = await getRecord(root, RECORD_DIR)

    expect(view?.dir).toBe(RECORD_DIR)
    expect(view?.steps[0]).toMatchObject({
      cache: "diverged",
      cacheDetail: "the recorded effect did not happen",
      effectResult: "diverged",
      source: "tests/checkout.danwo.ts:4",
    })
    expect(view?.steps[0]?.effects?.join("\n")).toContain("POST api.stripe.com/v1/charges")
    expect(view?.state).toContain('"charges": 0')
    expect(view?.page).toContain("EXPECTATION_FAILED")
  })

  it("serves a step's screenshot as a data URL", async () => {
    expect(await getScreenshot(root, RECORD_DIR, "screenshots/001-step-1.png")).toMatch(
      /^data:image\/png;base64,/,
    )
  })

  it("refuses paths outside .danwo/runs and files that are not screenshots", async () => {
    await expect(getRecord(root, "../../etc")).rejects.toThrow(/not inside/)
    await expect(getRecord(root, ".danwo/history")).rejects.toThrow(/not inside/)
    await expect(getScreenshot(root, RECORD_DIR, "../../../../package.json")).rejects.toThrow(
      /not a screenshot/,
    )
    await expect(getScreenshot(root, RECORD_DIR, "../../../../../x.png")).rejects.toThrow(
      /not inside/,
    )
    expect(() => insideArea(root, "runs", ".danwo/runs")).toThrow(/not inside/)
  })
})

describe("insights", () => {
  it("finds tests that flipped between runs, and ranks the slowest and costliest", async () => {
    await write(
      ".danwo/history/a.json",
      testRun("20261018-090000-aaaa", "2026-10-18T09:00:00.000Z", "passed"),
    )
    await write(
      ".danwo/history/b.json",
      testRun("20261018-100000-aaaa", "2026-10-18T10:00:00.000Z", "failed", RECORD_DIR),
    )
    await write(
      ".danwo/history/c.json",
      testRun("20261018-120000-aaaa", "2026-10-18T12:00:00.000Z", "flaky"),
    )

    const insights = await getInsights(root)

    expect(insights.runs).toBe(3)
    expect(insights.flaky.map((t) => t.id)).toEqual(["tests/checkout.danwo.ts › pays"])
    expect(insights.flaky[0]).toMatchObject({ flips: 2, flaky: 1, failed: 1, lastStatus: "flaky" })
    expect(insights.slowest[0]?.id).toBe("tests/checkout.danwo.ts › pays")
    expect(insights.costliest[0]).toMatchObject({ modelCalls: 9 })
  })
})

describe("impact", () => {
  it("splits each test's calls into providers, calls and webhooks", async () => {
    await write(".danwo/impact.json", {
      version: 1,
      tests: {
        "tests/checkout.danwo.ts › pays": {
          file: "tests/checkout.danwo.ts",
          routes: ["/", "/done"],
          calls: ["POST api.stripe.com/v1/checkout/sessions", "webhook checkout.session.completed"],
        },
      },
    })

    expect(await getImpact(root)).toEqual([
      {
        test: "tests/checkout.danwo.ts › pays",
        file: "tests/checkout.danwo.ts",
        routes: ["/", "/done"],
        providers: ["api.stripe.com"],
        calls: ["POST api.stripe.com/v1/checkout/sessions"],
        webhooks: ["checkout.session.completed"],
      },
    ])
  })
})
