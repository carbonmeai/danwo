import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  LiveEvent,
  LiveStep,
  MatrixHistory,
  RunKind,
  TestHistory,
  Usage,
} from "@danwo/runner/runner"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { eventStream } from "../src/lib/sse.ts"
import { sortBreakdown, testBreakdown } from "../src/modules/insights/test-breakdown.ts"
import { launchOf, literal, requestOf } from "../src/modules/live/launch-args.ts"
import { listedTests } from "../src/modules/live/launcher.ts"
import {
  activeRuns,
  feedOfProcess,
  feedPath,
  isAlive,
  isRunId,
  liveRun,
  readFrom,
} from "../src/modules/live/live-data.ts"
import {
  foldLive,
  parseFeed,
  progressOf,
  runningAttempts,
  stateWord,
} from "../src/modules/live/live-values.ts"

const AT = "2026-10-19T09:00:00.000Z"
const TEST = "tests/checkout.danwo.ts › pays"
const ID = "20261019-090000-ab12"

const step = (index: number, status: LiveStep["status"], usd = 0): LiveStep => ({
  index,
  kind: "agent",
  api: "agent.act",
  label: `step ${index}`,
  status,
  durationMs: status === "running" ? 0 : 40,
  actions: [],
  usd,
})

function run({
  pid = process.pid,
  planned = 2,
  id = ID,
  kind = "test",
}: Partial<{
  pid: number
  planned: number
  id: string
  kind: RunKind
}> = {}): LiveEvent {
  return { type: "run", version: 1, id, kind, pid, at: AT, title: "2 tests", planned }
}

const scope = { at: AT, test: TEST, attempt: "attempt-1" } as const

/** A test run part way: one attempt with a step done, one running, a call and a webhook. */
const PART_WAY: readonly LiveEvent[] = [
  run(),
  { type: "attempt", ...scope },
  { type: "step", ...scope, step: step(0, "running") },
  { type: "step", ...scope, step: step(0, "passed", 0.01) },
  { type: "step", ...scope, step: step(1, "running") },
  {
    type: "call",
    ...scope,
    call: {
      id: "c1",
      method: "POST",
      host: "api.stripe.com",
      path: "/v1/checkout/sessions",
      status: 200,
      durationMs: 12,
      fault: null,
      from: "server",
    },
  },
  {
    type: "delivery",
    ...scope,
    delivery: {
      topic: "checkout.session.completed",
      attempt: 1,
      status: 200,
      delivered: true,
      fault: null,
    },
  },
  { type: "test", at: AT, test: "tests/home.danwo.ts › loads", status: "failed", durationMs: 9 },
]

describe("a live run folded from its feed", () => {
  it("keeps each step once, as it last stood, with the calls and webhooks behind it", () => {
    const view = foldLive(PART_WAY)
    const [attempt] = view?.attempts ?? []

    expect(view?.state).toBe("running")
    expect(attempt?.steps.map((s) => [s.index, s.status])).toEqual([
      [0, "passed"],
      [1, "running"],
    ])
    expect(attempt?.calls).toHaveLength(1)
    expect(attempt?.deliveries).toHaveLength(1)
    expect(view?.usd).toBe(0.01)
    expect(view && progressOf(view)).toEqual({ done: 1, failed: 1, left: 1 })
    expect(view && runningAttempts(view)).toHaveLength(1)
  })

  it("finishes with its exit code, and stops when its process is gone without one", () => {
    const ended = foldLive([...PART_WAY, { type: "end", at: AT, exitCode: 1, durationMs: 5 }])

    expect(ended && stateWord(ended)).toBe("failed")
    expect(foldLive(PART_WAY, false)?.state).toBe("stopped")
    expect(foldLive([])).toBeUndefined()
  })

  it("counts a matrix's trials against its plan", () => {
    const view = foldLive([
      run({ planned: 1, kind: "matrix" }),
      { type: "plan", at: AT, planned: 4 },
      { type: "trial", at: AT, fault: null, status: "passed" },
      { type: "trial", at: AT, fault: "status 500 on POST /buy", status: "failed" },
    ])

    expect(view && progressOf(view)).toEqual({ done: 2, failed: 1, left: 2 })
    expect(view?.done.map((d) => d.name)).toEqual(["clean", "status 500 on POST /buy"])
  })

  it("skips a last line still being written", () => {
    expect(parseFeed(`${JSON.stringify(run())}\n{"type":"te`)).toHaveLength(1)
  })
})

describe("what the dashboard may run", () => {
  const known = [
    { id: TEST, file: "tests/checkout.danwo.ts" },
    { id: "tests/home.danwo.ts › loads (fast)", file: "tests/home.danwo.ts" },
  ]

  it("reruns the failed tests the project still has, each matched exactly", () => {
    const launch = launchOf({ action: "rerun-failed", runId: ID }, known, [
      "tests/home.danwo.ts › loads (fast)",
      "tests/gone.danwo.ts › left",
    ])

    expect(launch).toEqual({
      args: [
        "test",
        "tests/home.danwo.ts",
        "--grep",
        "^(?:tests\\/home\\.danwo\\.ts › loads \\(fast\\))$",
        "--record",
        "always",
      ],
      label: "rerun 1 failed test",
    })
    expect(launchOf({ action: "rerun-failed", runId: ID }, known, [])).toHaveProperty("error")
  })

  it("refuses a test the project does not have", () => {
    expect(launchOf({ action: "test", testId: "x; rm -rf /" }, known)).toHaveProperty("error")
  })

  it("matches a fault filter literally and refuses a long one", () => {
    const launch = launchOf(
      { action: "matrix", testId: TEST, faults: " status 500 (POST) " },
      known,
    )

    expect(launch).toHaveProperty("args", [
      "matrix",
      "tests/checkout.danwo.ts",
      "--grep",
      `^(?:${literal(TEST)})$`,
      "--faults",
      "status 500 \\(POST\\)",
    ])
    expect(
      launchOf({ action: "matrix", testId: TEST, faults: "x".repeat(121) }, known),
    ).toHaveProperty("error")
  })

  it("reads only well-formed requests from the browser", () => {
    expect(requestOf({ action: "matrix", testId: TEST, faults: "dup" })).toEqual({
      action: "matrix",
      testId: TEST,
      faults: "dup",
    })
    expect(requestOf({ action: "rerun-failed", runId: ID })).toEqual({
      action: "rerun-failed",
      runId: ID,
    })
    expect(() => requestOf({ action: "shell", command: "ls" })).toThrow("expected a run request")
    expect(() => requestOf({ action: "test", testId: 3 })).toThrow("expected a run request")
    expect(() => requestOf("test")).toThrow("expected a run request")
  })

  it("reads the project's tests from danwo test --list", () => {
    expect(
      listedTests(`CI note\n${JSON.stringify([{ id: TEST, file: "a.ts" }, { id: 1 }])}\n`),
    ).toEqual([{ id: TEST, file: "a.ts" }])
  })
})

describe("live feeds on disk", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "danwo-live-dash-"))
    await mkdir(join(root, ".danwo", "live"), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const write = (id: string, events: readonly LiveEvent[]) =>
    writeFile(feedPath(root, id), events.map((event) => `${JSON.stringify(event)}\n`).join(""))

  it("lists a run as going only while its process is alive and it has no last line", async () => {
    await write(ID, PART_WAY)
    await write("20261019-080000-0000", [
      run({ id: "20261019-080000-0000" }),
      { type: "end", at: AT, exitCode: 0, durationMs: 1 },
    ])
    await write("20261019-070000-0000", [
      run({ pid: 2 ** 22 + 12_345, id: "20261019-070000-0000" }),
    ])

    expect((await activeRuns(root)).map((active) => active.id)).toEqual([ID])
    expect(await feedOfProcess(root, process.pid)).toBe(ID)
    expect((await liveRun(root, "20261019-070000-0000"))?.state).toBe("stopped")
    expect(isAlive(process.pid)).toBe(true)
  })

  it("refuses anything but a run id", () => {
    expect(isRunId(ID)).toBe(true)
    expect(isRunId("../../etc/passwd")).toBe(false)
    expect(() => feedPath(root, "../x")).toThrow("not a run id")
  })

  it("reads from where it stopped, whole lines only", async () => {
    const path = feedPath(root, ID)

    await writeFile(path, '{"a":1}\n{"b"')

    const first = await readFrom(path, 0)

    expect(first.text).toBe('{"a":1}\n')
    await appendFile(path, ":2}\n")
    expect((await readFrom(path, first.next)).text).toBe('{"b":2}\n')
  })
})

describe("server-sent events", () => {
  it("sends named events and runs its cleanup once when it ends", async () => {
    let cleaned = 0
    const response = eventStream(new Request("http://localhost/"), (sink) => {
      sink.send("live", { n: 1 })
      sink.close()

      return () => cleaned++
    })

    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(await response.text()).toBe('event: live\ndata: {"n":1}\n\n')
    expect(cleaned).toBe(1)
  })
})

describe("every test across the history", () => {
  const usage: Usage = {
    cache: {},
    spent: { calls: 0, retries: 0, tokens: [0, 0], usd: 0.02 },
    steps: [],
  }

  function testRun(id: string, commit: string, status: string, ms: number): TestHistory {
    return {
      version: 1,
      kind: "test",
      id,
      startedAt: `2026-10-19T0${id.at(-1)}:00:00.000Z`,
      durationMs: ms,
      usage,
      commit,
      tests: [
        {
          id: TEST,
          status,
          attempts: [{ status: status === "flaky" ? "passed" : status, durationMs: ms, usage }],
        },
      ],
      brokenFiles: [],
    }
  }

  const matrix: MatrixHistory = {
    version: 1,
    kind: "matrix",
    id: "m1",
    startedAt: "2026-10-19T00:00:00.000Z",
    durationMs: 1,
    usage,
    testId: TEST,
    file: "tests/checkout.danwo.ts",
    clean: { fault: null, target: null, status: "passed", notes: [], calls: 1, deliveries: 0 },
    trials: [
      {
        fault: "duplicate on webhook",
        target: "webhook",
        status: "failed",
        notes: [],
        calls: 1,
        deliveries: 2,
      },
      {
        fault: "status 500 on POST",
        target: "outbound",
        status: "passed",
        notes: [],
        calls: 1,
        deliveries: 0,
      },
    ],
  }

  it("counts retries and mixed outcomes on one commit as flaky, and names the faults that break it", () => {
    // Newest first, as the history lists runs.
    const [row] = testBreakdown([
      testRun("r4", "bbb", "passed", 400),
      testRun("r3", "aaa", "failed", 300),
      testRun("r2", "aaa", "passed", 200),
      testRun("r1", "zzz", "flaky", 100),
      matrix,
    ])

    expect(row).toMatchObject({
      id: TEST,
      runs: 4,
      passRate: 0.75,
      flakeRate: 0.75,
      medianMs: 250,
      matrixRuns: 1,
      breakingFaults: [{ fault: "duplicate on webhook", runs: 1 }],
      lastRun: "r4",
    })
    expect(row?.costUsd).toBeCloseTo(0.08)
  })

  it("sorts by any figure, either way", () => {
    const rows = testBreakdown([
      testRun("r1", "a", "passed", 100),
      { ...testRun("r2", "a", "passed", 900), tests: [] },
      { ...matrix, testId: "b" },
    ])

    expect(sortBreakdown(rows, "time").map((r) => r.id)).toEqual([TEST, "b"])
    expect(sortBreakdown(rows, "faults").map((r) => r.id)).toEqual(["b", TEST])
    expect(sortBreakdown(rows, "faults", true).map((r) => r.id)).toEqual([TEST, "b"])
  })
})
