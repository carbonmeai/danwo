import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  HistoryTrial,
  MatrixHistory,
  RunHistory,
  TestHistory,
  Usage,
} from "@danwo/runner/runner"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { launchOf, requestOf } from "../src/modules/live/launch-args.ts"
import { feedbackOf, keepFeedback } from "../src/modules/overlay/feedback-data.ts"
import {
  afterBody,
  checkWords,
  consoleLines,
  fixPrompt,
  networkRows,
  runStartOf,
  shownRows,
  transcriptOf,
  warningsOf,
} from "../src/modules/overlay/overlay-values.ts"
import { overviewOf, rangeOf } from "../src/modules/overview/overview-data.ts"
import { type RecordView, getRecord } from "../src/modules/record/record-data.ts"
import { listRuns } from "../src/modules/runs/runs-data.ts"
import { settingsOf } from "../src/modules/settings/settings-data.ts"
import { matrixVerdict } from "../src/modules/tests/matrix-verdict.ts"
import { matrixWords } from "../src/modules/tests/test-values.ts"
import { listTests } from "../src/modules/tests/tests-data.ts"

const NO_USAGE: Usage = {
  cache: {},
  spent: { calls: 0, retries: 0, tokens: [0, 0], usd: 0 },
  steps: [],
}
const PAYS = "tests/checkout.danwo.ts › pays"
const LOADS = "tests/home.danwo.ts › loads"
const NOW = Date.parse("2026-10-19T12:00:00.000Z")

function testRun(id: string, startedAt: string, pays: string, record?: string): TestHistory {
  return {
    version: 1,
    kind: "test",
    id,
    startedAt,
    durationMs: 4_000,
    usage: NO_USAGE,
    tests: [
      {
        id: PAYS,
        status: pays,
        attempts: [{ status: pays, durationMs: 3_000, ...(record && { record }) }],
      },
      { id: LOADS, status: "passed", attempts: [{ status: "passed", durationMs: 500 }] },
    ],
    brokenFiles: [],
  }
}

function trial(fault: string, status: HistoryTrial["status"]): HistoryTrial {
  return { fault, target: "webhook", status, notes: [], calls: 4, deliveries: 2 }
}

function matrixRun(
  id: string,
  startedAt: string,
  duplicate: HistoryTrial["status"],
): MatrixHistory {
  return {
    version: 1,
    kind: "matrix",
    id,
    startedAt,
    durationMs: 30_000,
    usage: NO_USAGE,
    testId: PAYS,
    file: "tests/checkout.danwo.ts",
    clean: { ...trial("", "passed"), fault: null, target: null },
    trials: [
      trial("duplicate on webhook paid", duplicate),
      trial("status 500 on POST /v1", "passed"),
    ],
  }
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-workspace-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function write(path: string, value: unknown): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true })
  await writeFile(join(root, path), JSON.stringify(value))
}

describe("the tests list", () => {
  it("says what the newest matrix run made of a test", () => {
    expect(matrixVerdict([])).toEqual({ kind: "none" })
    expect(matrixWords(matrixVerdict([matrixRun("m2", "2026-10-19T10:00:00Z", "failed")]))).toBe(
      "breaks under: duplicate on webhook paid",
    )
    expect(
      matrixWords(
        matrixVerdict([
          matrixRun("m2", "2026-10-19T10:00:00Z", "passed"),
          matrixRun("m1", "2026-10-18T10:00:00Z", "failed"),
        ]),
      ),
    ).toBe("held 2/2")
  })

  it("lists every test, run or not, with its last verdict and its picture", async () => {
    const dir = ".danwo/runs/r1/pays/attempt-1"

    await write(`${dir}/record.json`, {
      version: 1,
      test: PAYS,
      steps: [{ index: 0, screenshot: "step-0.png" }],
      videos: [{ file: "video/tab-1.webm" }],
    })

    const runs: RunHistory[] = [
      testRun("t2", "2026-10-19T10:00:00Z", "failed", dir),
      matrixRun("m1", "2026-10-18T10:00:00Z", "failed"),
    ]
    const rows = await listTests(root, runs, [
      { id: PAYS, file: "tests/checkout.danwo.ts" },
      { id: "tests/new.danwo.ts › waits", file: "tests/new.danwo.ts" },
    ])
    const pays = rows.find((row) => row.id === PAYS)

    expect(rows.map((row) => row.id)).toEqual([PAYS, LOADS, "tests/new.danwo.ts › waits"])
    expect(pays?.last).toMatchObject({ status: "failed", runId: "t2" })
    expect(pays?.matrix.kind).toBe("broke")
    expect(pays?.thumb).toMatchObject({ dir, screenshot: "step-0.png" })
    expect(pays?.thumb?.video).toMatch(/^\/media\/r1\/pays\/attempt-1\/video\/tab-1\.webm$/)
    expect(rows.find((row) => row.id.startsWith("tests/new"))?.last).toBeUndefined()
    expect(pays?.recordingDeleted).toBe(false)
  })

  it("marks a test whose every recording was deleted with its run", async () => {
    const rows = await listTests(
      root,
      [testRun("t2", "2026-10-19T10:00:00Z", "failed", ".danwo/runs/gone/pays/attempt-1")],
      [],
    )

    expect(rows.find((row) => row.id === PAYS)).toMatchObject({
      recordingDeleted: true,
    })
    expect(rows.find((row) => row.id === LOADS)).toMatchObject({
      recordingDeleted: false,
    })
  })
})

describe("the overview", () => {
  const runs: RunHistory[] = [
    testRun("t3", "2026-10-19T10:00:00Z", "failed"),
    testRun("t2", "2026-10-18T10:00:00Z", "passed"),
    matrixRun("m1", "2026-10-18T09:00:00Z", "failed"),
    testRun("t0", "2026-09-10T10:00:00Z", "passed"),
  ]

  it("counts the window against the one before it, day by day", () => {
    const overview = overviewOf(runs, 30, NOW)

    expect(overview.runs).toEqual({ now: 3, prior: 1 })
    expect(overview.failedTests.now).toBe(1)
    expect(overview.days).toHaveLength(30)
    expect(overview.days.at(-1)).toMatchObject({ day: "2026-10-19", passed: 0, failed: 1 })
    expect(overview.days.at(-2)).toMatchObject({ day: "2026-10-18", passed: 1, failed: 1 })
    expect(overview.failing.map((run) => run.id)).toEqual(["t3", "m1"])
    expect(overview.broken).toEqual([
      { id: PAYS, runId: "m1", faults: ["duplicate on webhook paid"] },
    ])
  })

  it("reads a range from the address, and nothing else", () => {
    expect(rangeOf("7")).toBe(7)
    expect(rangeOf(90)).toBe(90)
    expect(rangeOf("14")).toBeUndefined()
  })
})

describe("the runs list's filters", () => {
  it("keeps runs by kind, status and day", async () => {
    await write(".danwo/history/t3.json", testRun("t3", "2026-10-19T10:00:00.000Z", "failed"))
    await write(".danwo/history/t2.json", testRun("t2", "2026-10-18T10:00:00.000Z", "passed"))
    await write(".danwo/history/m1.json", matrixRun("m1", "2026-10-18T09:00:00.000Z", "passed"))

    const ids = async (filter: Parameters<typeof listRuns>[3]) =>
      (await listRuns(root, 0, 50, filter, NOW)).rows.map((row) => row.id)

    expect(await ids({ kind: "matrix" })).toEqual(["m1"])
    expect(await ids({ status: "failed" })).toEqual(["t3"])
    expect(await ids({ day: "2026-10-18" })).toEqual(["t2", "m1"])
    expect(await ids({ days: 1 })).toEqual(["t3"])
    expect((await listRuns(root, 0, 50, { kind: "test" }, NOW)).counts).toEqual({
      test: 2,
      matrix: 1,
    })
  })
})

describe("running tests from the test library", () => {
  const known = [
    { id: PAYS, file: "tests/checkout.danwo.ts" },
    { id: LOADS, file: "tests/home.danwo.ts" },
  ]

  it("runs the picked tests, or all of them, recording whatever happens", () => {
    expect(launchOf({ action: "tests", testIds: [] }, known)).toEqual({
      args: ["test", "--record", "always"],
      label: "run every test",
    })
    expect(launchOf({ action: "tests", testIds: [LOADS, "gone"] }, known)).toMatchObject({
      args: ["test", "tests/home.danwo.ts", "--grep", expect.any(String), "--record", "always"],
      label: "run 1 test",
    })
    expect(launchOf({ action: "tests", testIds: ["gone"] }, known)).toHaveProperty("error")
  })

  it("reads a list of ids only when every one is text", () => {
    expect(requestOf({ action: "tests", testIds: [PAYS] })).toEqual({
      action: "tests",
      testIds: [PAYS],
    })
    expect(() => requestOf({ action: "tests", testIds: [1] })).toThrow("expected a run request")
    expect(() => requestOf({ action: "tests", testIds: "x" })).toThrow("expected a run request")
  })
})

const RECORD_DIR = ".danwo/runs/r1/pays/duplicate"

const RECORD_FILE = {
  version: 1,
  test: PAYS,
  run: { kind: "matrix", fault: { label: "duplicate on webhook paid" } },
  status: "failed",
  error: { code: "INVARIANT_FAILED", class: "test", message: "expected 1000 to be 500" },
  notes: ["credits granted twice"],
  startedAt: "2026-10-19T10:00:00.000Z",
  durationMs: 2_000,
  steps: [],
  appLog: [
    { at: "", level: "info", source: "console", text: "loaded", step: 0 },
    { at: "", level: "info", source: "navigation", text: "http://app/", step: 0 },
    { at: "", level: "error", source: "page-error", text: "boom", step: 1 },
  ],
  exchanges: [
    {
      id: "1",
      disposition: "routed",
      method: "POST",
      host: "api.stripe.com",
      path: "/v1/checkout/sessions?x=1",
      startedAt: "2026-10-19T10:00:00.500Z",
      fault: "status 500",
      status: 500,
      durationMs: 12,
      aborted: false,
      response: {
        headers: { "content-type": "application/json; charset=utf-8" },
        body: null,
        bytes: 0,
        truncated: false,
      },
    },
    {
      id: "2",
      disposition: "routed",
      method: "GET",
      host: "app",
      path: "/main.js",
      startedAt: "2026-10-19T10:00:00.100Z",
      fault: null,
      status: 200,
      durationMs: 3,
      aborted: false,
    },
  ],
  deliveries: [
    { topic: "checkout.session.completed", fault: "duplicate", status: 200, attempt: 2 },
  ],
  state: {},
}

/** The record above as the dashboard reads it from disk. */
async function recorded(): Promise<RecordView["record"]> {
  await write(`${RECORD_DIR}/record.json`, RECORD_FILE)

  const view = await getRecord(root, RECORD_DIR)

  if (view === undefined) throw new Error("the record did not load")

  return view.record
}

describe("the run overlay", () => {
  it("pins the error, the faults injected and the notes", async () => {
    expect(warningsOf(await recorded())).toEqual([
      { kind: "error", text: "expected 1000 to be 500" },
      { kind: "fault", text: "status 500 on POST api.stripe.com/v1/checkout/sessions?x=1" },
      { kind: "fault", text: "duplicate on webhook checkout.session.completed" },
      { kind: "note", text: "credits granted twice" },
    ])
  })

  it("sorts the console by level as devtools does, and filters it by words", async () => {
    const { appLog } = await recorded()

    expect(consoleLines(appLog, "log", "").map((line) => line.text)).toEqual(["loaded"])
    expect(consoleLines(appLog, "info", "").map((line) => line.text)).toEqual(["http://app/"])
    expect(consoleLines(appLog, "all", "BOOM").map((line) => line.text)).toEqual(["boom"])
  })

  it("lists calls oldest first, hiding static assets unless asked", async () => {
    const rows = networkRows(await recorded())

    expect(rows.map((row) => row.name)).toEqual(["main.js", "sessions"])
    expect(rows[1]).toMatchObject({ atMs: 500, status: "500", type: "json", fault: "status 500" })
    expect(shownRows(rows, "", false).map((row) => row.id)).toEqual(["1"])
    expect(shownRows(rows, "get", true).map((row) => row.id)).toEqual(["2"])
  })

  it("puts settling and checks after the body, a check with what it got and wanted", () => {
    const passed = { status: "passed", check: { actual: "1", expected: "1" } }
    const failed = { status: "failed", check: { actual: "[1,2]", expected: "[1]" } }

    expect(checkWords(passed)).toBe("got 1")
    expect(checkWords(failed)).toBe("expected [1], got [1,2]")
    expect(checkWords({ status: "passed" })).toBeUndefined()
    expect([afterBody({ phase: "body" }), afterBody({ phase: "settle" })]).toEqual([false, true])
    expect(afterBody({ phase: "checks" })).toBe(true)
  })

  it("jumps each step to where it starts, and wraps the failure page as a prompt", () => {
    const steps = [
      {
        index: 0,
        kind: "locator" as const,
        label: "Buy",
        api: "click",
        status: "passed",
        durationMs: 9,
      },
    ]
    const replay = {
      videos: [],
      frames: [],
      marks: [{ kind: "step" as const, label: "Buy", atMs: 120, endMs: 200, bad: false, step: 0 }],
      segments: [],
      spanMs: 200,
      stepVideos: {},
      tabMarks: [],
    }

    expect(transcriptOf({ steps }, replay)[0]?.atMs).toBe(120)
    expect(fixPrompt(PAYS, "# Failure")).toMatch(
      /^The danwo test "tests\/checkout.danwo.ts › pays" failed/,
    )
    expect(fixPrompt(PAYS, "# Failure").endsWith("# Failure")).toBe(true)
    expect(
      fixPrompt(PAYS, "# Failure", {
        verdict: "test",
        confidence: "likely",
        reason: "the locator may be stale",
      }),
    ).toContain("Test issue (likely), because the locator may be stale. Fix the test")
    expect(runStartOf(".danwo/runs/20261018-100000-aaaa/pays/attempt-1")).toBe(
      "2026-10-18T10:00:00Z",
    )
    expect(runStartOf("elsewhere")).toBeUndefined()
  })

  it("keeps a vote on a recording, and refuses one outside the run folders", async () => {
    await keepFeedback(root, { record: ".danwo/runs/r1/pays/attempt-1", vote: "up" }, new Date(NOW))

    expect(await readFile(join(root, ".danwo/feedback.jsonl"), "utf8")).toContain('"vote":"up"')
    expect(feedbackOf({ record: "r", vote: "down" })).toEqual({ record: "r", vote: "down" })
    expect(() => feedbackOf({ record: "r", vote: "maybe" })).toThrow("an up or down vote")
    expect(() => feedbackOf(null)).toThrow("an up or down vote")
    await expect(keepFeedback(root, { record: "../etc", vote: "down" })).rejects.toThrow(
      "is not inside .danwo/runs",
    )
  })
})

describe("the settings page", () => {
  it("names the config file and counts what .danwo keeps", async () => {
    await writeFile(join(root, "danwo.config.ts"), "export default {}")
    await write(".danwo/history/a.json", {})
    await mkdir(join(root, ".danwo/runs/r1"), { recursive: true })

    expect(await settingsOf(root)).toEqual({
      root,
      config: "danwo.config.ts",
      runsKept: 1,
      keepRuns: 50,
      historyKept: 1,
    })
  })
})
