/**
 * What runs report without a browser: secret values redacted in every form they travel in, the
 * Markdown failure page of a flight record, `danwo cache` over a project's recordings, the run's
 * cache and model lines, and the matrix's "not judged" trials.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { formatMatrix, type RunOutcome } from "@danwo/matrix"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { addUsage, cacheLine, modelLine, usageOf } from "../src/record/usage.ts"
import { ReplayStore } from "../src/replay/store.ts"
import { runCache } from "../src/runner/cache-command.ts"
import { failurePage } from "../src/runner/failure-page.ts"
import type { FlightRecord, RecordedStep } from "../src/runner/record.ts"
import { renderReport } from "../src/runner/report-html.ts"
import { SecretVault } from "../src/secrets/index.ts"

const SECRET = "Pa ss&w<rd>/2026"

describe("redaction of a secret's other forms", () => {
  const vault = new SecretVault({ password: SECRET })
  const hidden = "[secret password]"

  it.each([
    ["as written", SECRET],
    ["in JSON", JSON.stringify(SECRET).slice(1, -1)],
    ["percent-encoded", encodeURIComponent(SECRET)],
    ["percent-encoded, lower-case hex", encodeURIComponent(SECRET).toLowerCase()],
    ["form-encoded", encodeURIComponent(SECRET).replaceAll("%20", "+")],
    ["HTML-escaped", "Pa ss&amp;w&lt;rd&gt;/2026"],
    ["base64", Buffer.from(SECRET).toString("base64")],
    ["base64url", Buffer.from(SECRET).toString("base64url")],
    ["upper-cased", SECRET.toUpperCase()],
  ])("finds it %s", (_form, shown) => {
    expect(vault.redact(`before ${shown} after`)).toBe(`before ${hidden} after`)
  })
})

/** A step of a recorded run. */
function step(over: Partial<RecordedStep>): RecordedStep {
  return {
    id: "s",
    index: 0,
    kind: "agent",
    api: "agent.act",
    label: "pay for the order",
    status: "passed",
    startedAt: "2026-10-17T00:00:00.000Z",
    durationMs: 1200,
    events: [],
    ...over,
  }
}

const RECORD: FlightRecord = {
  version: 1,
  test: "tests/pay.danwo.ts › pays",
  run: { kind: "test", attempt: 1 },
  status: "failed",
  error: {
    code: "EXPECTATION_FAILED",
    class: "test",
    name: "ExpectationFailed",
    message: 'expect(getByText("Paid")).toBeVisible() failed after 10000 ms',
    source: { file: "tests/pay.danwo.ts", line: 12 },
  },
  stopped: undefined,
  divergence: undefined,
  notes: ["session ada: reused"],
  startedAt: "2026-10-17T00:00:00.000Z",
  durationMs: 4300,
  steps: [
    step({
      cache: { mode: "missed", saved: false, recording: "test-failed" },
      events: [
        {
          kind: "model",
          at: "2026-10-17T00:00:01.000Z",
          inputTokens: 900,
          outputTokens: 40,
          costUsd: 0.004,
        },
        {
          kind: "model",
          at: "2026-10-17T00:00:02.000Z",
          inputTokens: 950,
          outputTokens: 30,
          costUsd: 0.003,
        },
      ],
      source: { file: "tests/pay.danwo.ts", line: 9 },
    }),
    step({
      index: 1,
      kind: "assertion",
      api: "expect.toBeVisible",
      label: 'expect(getByText("Paid")).toBeVisible()',
      status: "failed",
      error: { code: "EXPECTATION_FAILED", message: "not visible" },
    }),
  ],
  appLog: [
    {
      at: "2026-10-17T00:00:03.000Z",
      level: "error",
      source: "console",
      text: "payment failed",
      step: 0,
    },
    { at: "2026-10-17T00:00:03.100Z", level: "info", source: "console", text: "noise", step: 0 },
  ],
  failure: { screen: "screen.txt", candidates: ['heading "Payment failed"'] },
  exchanges: [
    {
      id: "e1",
      disposition: "routed",
      method: "POST",
      host: "api.stripe.com",
      path: "/v1/checkout/sessions",
      startedAt: "2026-10-17T00:00:01.500Z",
      fault: "status 500",
      status: 500,
      durationMs: 3,
      aborted: false,
      response: {
        headers: {},
        body: '{"error":{"type":"api_error"}}',
        bytes: 30,
        truncated: false,
      },
    },
    {
      id: "e2",
      disposition: "routed",
      method: "GET",
      host: "api.stripe.com",
      path: "/v1/prices",
      startedAt: "2026-10-17T00:00:01.400Z",
      fault: null,
      status: 200,
      durationMs: 2,
      aborted: false,
    },
  ],
  deliveries: [],
  state: { stripe: { customers: 1 } },
}

/** The record with the wait for background work and a failed invariant check after its body. */
const CHECKED: FlightRecord = {
  ...RECORD,
  steps: [
    ...RECORD.steps,
    step({
      index: 2,
      kind: "settle",
      api: "settle",
      label: "waiting for background work",
      phase: "settle",
      durationMs: 2_100,
      waitedOn: ["stripe · 2.1 s · 1 webhook delivery"],
    }),
    step({
      index: 3,
      kind: "check",
      api: "expect.toBe",
      label: "expect(credits granted).toBe(500)",
      phase: "checks",
      status: "failed",
      check: { actual: "1000", expected: "500" },
    }),
  ],
}

describe("the failure page", () => {
  it("tells what failed, where, at what cost, and what the app sent", () => {
    const page = failurePage(RECORD, 'heading "Payment failed"')

    expect(page).toContain("# ✗ tests/pay.danwo.ts › pays")
    expect(page).toContain("attempt 1 · failed · EXPECTATION_FAILED (test) · 4.3 s")
    expect(page).toContain("**Error at tests/pay.danwo.ts:12:**")
    expect(page).toContain(
      "| 0 | pay for the order | passed | missed, not kept: the test failed | 2 ($0.0070) | 1200 | tests/pay.danwo.ts:9 |",
    )
    expect(page).toContain(
      '| 1 | expect(getByText("Paid")).toBeVisible() | failed: EXPECTATION_FAILED |',
    )
    expect(page).toContain("- step 0 · error · payment failed")
    expect(page).not.toContain("noise")
    expect(page).toContain("1 of 2 calls through the proxy:")
    expect(page).toContain("`POST api.stripe.com/v1/checkout/sessions` → 500 · fault: status 500")
    expect(page).not.toContain("/v1/prices")
    expect(page).toContain("### stripe")
  })

  it("lists the wait for background work and the invariant's checks after the steps", () => {
    const page = failurePage(CHECKED)
    const checks = page.slice(page.indexOf("## Checks"))

    expect(page.indexOf("## Checks")).toBeGreaterThan(page.indexOf("## Steps"))
    expect(checks).toContain(
      "- ✓ waited 2.1 s for background work: stripe · 2.1 s · 1 webhook delivery",
    )
    expect(checks).toContain("- ✗ expect(credits granted).toBe(500) — expected 500, got 1000")
    expect(page).not.toContain("| 3 | expect(credits granted)")
  })

  it("lists them in the offline report too, a failed check marked failed", () => {
    const html = renderReport("20261019-120000-ab12", [
      { record: CHECKED, dir: "tests-pay/attempt-1", screen: undefined },
    ])
    const checks = html.slice(html.indexOf("<h4>Checks</h4>"))

    expect(html.indexOf("<h4>Checks</h4>")).toBeGreaterThan(html.indexOf("<h4>Steps</h4>"))
    expect(checks).toContain(
      '<li class="failed">✗ expect(credits granted).toBe(500) — expected 500, got 1000</li>',
    )
  })

  it("caps a long screen", () => {
    const page = failurePage(RECORD, "x".repeat(10_000))

    expect(page).toContain("… (6000 more characters)")
  })
})

describe("run summary lines", () => {
  it("counts cache outcomes and model use over attempts", () => {
    const one = usageOf(RECORD.steps)
    const two = usageOf([
      step({ cache: { mode: "replayed" } }),
      step({ cache: { mode: "stale", changed: ["params"] } }),
    ])
    const total = addUsage([one, two])

    expect(cacheLine(total.cache)).toBe(
      "cache: 1 replayed · 0 relocated · 0 handed off · 1 missed · 1 stale",
    )
    expect(modelLine(total)).toBe("model: 2 calls · 1.9k in / 70 out · $0.0070")
    expect(cacheLine({})).toBeUndefined()
  })
})

describe("danwo cache", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-cache-cmd-"))
    await writeFile(
      join(dir, "danwo.config.ts"),
      `export default { cache: { dir: "recordings" } }\n`,
    )

    for (const journey of ["tests/a.danwo.ts › one", "tests/b.danwo.ts › two"]) {
      const store = new ReplayStore({
        dir: join(dir, "recordings"),
        mode: "read-write",
        projectId: "danwo",
        journey,
        appIdentity: "http://app",
      })

      await store.writeExtract(
        store.key({ kind: "extract", step: 0, instruction: "the total", params: {} }),
        {
          version: 1,
          kind: "extract",
          instruction: "the total",
          recordedAt: "2026-10-17T00:00:00.000Z",
          fields: [{ path: "total", target: { testId: "total" }, as: "number" }],
        },
      )
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it("lists, counts and clears recordings by journey", async () => {
    const lines: string[] = []
    const write = (line: string) => lines.push(line)

    await runCache("ls", { cwd: dir, write })
    expect(lines).toEqual([
      'tests/a.danwo.ts › one  #0 extract  "the total"  2026-10-17T00:00:00',
      'tests/b.danwo.ts › two  #0 extract  "the total"  2026-10-17T00:00:00',
    ])

    lines.length = 0
    await runCache("stats", { cwd: dir, write })
    expect(lines[0]).toMatch(/^recordings: 2 recordings in 2 journeys, /)

    lines.length = 0
    await runCache("clear", { cwd: dir, write, journey: "tests/a.danwo.ts › one" })
    expect(lines).toEqual(["removed 1 recordings from recordings"])
    expect(await readdir(join(dir, "recordings"))).toHaveLength(1)
  })
})

/** A faulted trial's outcome. */
const outcome = (status: RunOutcome["status"], label: string): RunOutcome => ({
  fault: { target: "webhook", topic: "t", occurrence: 0, fault: { kind: "duplicate" }, label },
  status,
  error: status === "not-judged" ? "not judged (blocked): nothing recorded" : null,
  exchanges: [],
  deliveries: [],
  notes: [],
})

describe("the matrix's not-judged trials", () => {
  it("lists them apart from failures", () => {
    const clean: RunOutcome = {
      fault: null,
      status: "passed",
      error: null,
      exchanges: [],
      deliveries: [],
      notes: [],
    }

    const text = formatMatrix({
      clean,
      runs: [outcome("passed", "a"), outcome("not-judged", "b"), outcome("failed", "c")],
    })

    expect(text).toContain("NOT JUDGED  b\n        not judged (blocked): nothing recorded")
    expect(text).toContain("faults: 1 passed, 1 failed, 1 not judged")
  })
})
