import type { HistoryTrial, MatrixHistory, TestHistory, Usage } from "@danwo/runner/runner"
import { describe, expect, it } from "vitest"

import { toneOf, wordOf } from "../src/lib/verdicts.ts"
import { hasVerdict, runVerdicts, testVerdict, verdictParam, WHOSE_TONE } from "../src/lib/whose.ts"
import {
  invariantSummary,
  listedTrials,
  planNote,
  ruleOf,
} from "../src/modules/matrix/matrix-values.ts"
import { cacheTone, statusColor } from "../src/modules/record/record-values.ts"
import { cacheLine, sortedTests, testFigures } from "../src/modules/run/run-values.ts"
import type { RunRow } from "../src/modules/runs/runs-data.ts"
import { countLine, median, runText, verdictOf } from "../src/modules/runs/runs-values.ts"

const USAGE: Usage = {
  cache: {},
  spent: { calls: 0, retries: 0, tokens: [0, 0], usd: 0 },
  steps: [],
}

function row(counts: Partial<RunRow["counts"]>): RunRow {
  return {
    id: "r",
    kind: "test",
    startedAt: "2026-10-19T00:00:00.000Z",
    durationMs: 1_000,
    title: "3 tests",
    counts: { passed: 0, failed: 0, flaky: 0, skipped: 0, notJudged: 0, invalid: 0, ...counts },
    costUsd: 0,
    modelCalls: 0,
    recorded: false,
    pruned: false,
    whose: "",
  }
}

function trial(fault: string, status: HistoryTrial["status"]): HistoryTrial {
  return { fault, target: null, status, notes: [], calls: 1, deliveries: 0 }
}

function testRun(statuses: readonly TestHistory["tests"][number]["status"][], usage = USAGE) {
  const run: TestHistory = {
    version: 1,
    kind: "test",
    id: "t",
    startedAt: "2026-10-19T00:00:00.000Z",
    durationMs: 1_000,
    usage,
    tests: statuses.map((status, i) => ({ id: `t${i}`, status, attempts: [] })),
    brokenFiles: [],
  }

  return run
}

function matrixRun(trials: readonly HistoryTrial[], judgedBy?: MatrixHistory["judgedBy"]) {
  const run: MatrixHistory = {
    version: 1,
    kind: "matrix",
    id: "m",
    startedAt: "2026-10-19T00:00:00.000Z",
    durationMs: 1_000,
    usage: USAGE,
    testId: "buys credits",
    file: "tests/buy.danwo.ts",
    clean: trial("clean", "passed"),
    trials,
    ...(judgedBy !== undefined && { judgedBy }),
  }

  return run
}

describe("verdict words", () => {
  it("reads every status in one of five colours, and writes codes as words", () => {
    expect(toneOf("timed-out")).toBe("failed")
    expect(toneOf("relocated")).toBe("flaky")
    expect(toneOf("something new")).toBe("invalid")
    expect(wordOf("not-judged")).toBe("not judged")
    expect(wordOf("passed")).toBe("passed")
  })
})

describe("the runs list", () => {
  it("names a run by its worst verdict", () => {
    expect(verdictOf(row({ passed: 3, failed: 1, flaky: 1 }))).toBe("failed")
    expect(verdictOf(row({ passed: 3, flaky: 1 }))).toBe("flaky")
    expect(verdictOf(row({ passed: 3 }))).toBe("passed")
    expect(verdictOf(row({ notJudged: 2 }))).toBe("not-judged")
    expect(verdictOf(row({ invalid: 1 }))).toBe("invalid")
    expect(verdictOf(row({}))).toBe("skipped")
  })

  it("writes the counts in words and filters on them", () => {
    const failing = row({ passed: 2, failed: 1, skipped: 1 })

    expect(countLine(failing)).toBe("2 passed, 1 failed, 1 invalid or skipped")
    expect(runText(failing)).toContain("danwo test")
    expect(runText(failing)).toContain("failed")
    expect(
      countLine({
        ...row({ passed: 1, failed: 3 }),
        whose: "2 app bugs · 1 test issue",
      }),
    ).toBe("1 passed, 3 failed: 2 app bugs · 1 test issue")
  })

  it("takes the middle run time, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe("a test run", () => {
  it("puts failures first and sums the verdicts", () => {
    const run = testRun(["passed", "flaky", "timed-out", "skipped"])

    expect(sortedTests(run).map((test) => test.status)).toEqual([
      "timed-out",
      "flaky",
      "passed",
      "skipped",
    ])
    expect(testFigures(run)).toMatchObject({
      title: "4 tests",
      passed: 1,
      flaky: 1,
      failed: 1,
      spend: "no model calls",
    })
  })

  it("words the spend with the replay cache once a model was called", () => {
    const usage: Usage = {
      ...USAGE,
      cache: { replayed: 3, missed: 1 },
      spent: { ...USAGE.spent, calls: 2 },
    }

    expect(testFigures(testRun(["passed"], usage)).spend).toBe(
      "2 calls · 75% from the replay cache",
    )
    expect(testFigures(testRun(["passed"])).title).toBe("1 test")
  })

  it("adds up cache outcomes across attempts", () => {
    expect(
      cacheLine([
        { ...USAGE, cache: { replayed: 2 } },
        undefined,
        { ...USAGE, cache: { replayed: 1, missed: 1 } },
      ]),
    ).toBe("3 replayed, 1 missed")
    expect(cacheLine([undefined])).toBe("–")
  })
})

describe("a matrix run", () => {
  it("says how much held, and lists the trials that broke first", () => {
    const run = matrixRun(
      [trial("a", "passed"), trial("b", "failed"), trial("c", "not-judged"), trial("d", "invalid")],
      "invariant",
    )

    expect(invariantSummary(run)).toMatchObject({
      broke: true,
      label: "Invariant",
      headline: "Broke under 1 of 4",
      faults: "faults",
    })
    expect(invariantSummary(run).shares.map((share) => share.count)).toEqual([1, 1, 1, 1])
    expect(listedTrials(run).map((t) => t.fault)).toEqual(["b", "c", "d", "a"])
    expect(ruleOf(run)).toContain("invariant must hold")
  })

  it("says how the plan was focused: planned of all, skipped as setup and by budget", () => {
    const run = {
      ...matrixRun([trial("a", "passed")], "invariant"),
      plan: {
        total: 2039,
        planned: 40,
        skipped: { setup: 1608, background: 0, repeats: 278, kinds: 71, budget: 42 },
      },
    }

    expect(planNote(run)).toBe(
      "40 planned of 2039: 1608 skipped as setup, 42 skipped by budget, 278 repeats folded, 71 lesser kinds",
    )
    expect(planNote(matrixRun([]))).toBeUndefined()
  })

  it("reads as held when no fault broke it", () => {
    const run = matrixRun([trial("a", "passed")], "body")

    expect(invariantSummary(run)).toMatchObject({
      broke: false,
      label: "What must hold",
      headline: "Held under 1 of 1",
      faults: "fault",
    })
    expect(ruleOf(run)).toContain("must pass with every fault")
    expect(ruleOf(matrixRun([]))).toContain("judged the same way")
  })
})

describe("a flight record", () => {
  it("colours the replay cache's answer", () => {
    expect(cacheTone("replayed")).toBe("hit")
    expect(cacheTone("stale")).toBe("partial")
    expect(cacheTone("diverged")).toBe("bad")
    expect(cacheTone("missed")).toBe("miss")
  })

  it("colours an HTTP status by its class", () => {
    expect(statusColor({ outcome: "200", bad: false })).toBe("verdict.passed.fg")
    expect(statusColor({ outcome: "302", bad: false })).toBe("ink.muted")
    expect(statusColor({ outcome: "404", bad: true })).toBe("verdict.flaky.fg")
    expect(statusColor({ outcome: "503", bad: true })).toBe("verdict.failed.fg")
    expect(statusColor({ outcome: "aborted", bad: true })).toBe("verdict.failed.fg")
    expect(statusColor({ outcome: "done", bad: false })).toBe("ink.muted")
  })
})

describe("whose failure", () => {
  const appBug = { verdict: "app", confidence: "certain", reason: "the app answered 500" } as const
  const failing = (status: string): TestHistory["tests"][number] => ({
    id: status,
    status,
    attempts: [{ status: "failed", durationMs: 1, verdict: appBug }],
  })

  it("reads a failing test's last verdict, and none for a test that passed", () => {
    expect(testVerdict(failing("failed"))).toEqual(appBug)
    expect(testVerdict(failing("flaky"))).toBeUndefined()
    expect(testVerdict({ id: "t", status: "failed", attempts: [] })).toBeUndefined()
  })

  it("collects a run's failure verdicts and filters on them", () => {
    const run = { ...testRun([]), tests: [failing("failed"), failing("passed")] }
    const broke = { ...trial("dup", "failed"), verdict: appBug }

    expect(runVerdicts(run)).toEqual([appBug])
    expect(hasVerdict(run, "app")).toBe(true)
    expect(hasVerdict(run, "test")).toBe(false)
    expect(hasVerdict(run, undefined)).toBe(true)
    expect(runVerdicts(matrixRun([broke, trial("x", "invalid")]))).toEqual([appBug])
  })

  it("reads a verdict from an address, and nothing else", () => {
    expect(verdictParam("danwo")).toBe("danwo")
    expect(verdictParam("someone")).toBeUndefined()
    expect(WHOSE_TONE.app).toBe("failed")
    expect(WHOSE_TONE.test).toBe("flaky")
  })
})
