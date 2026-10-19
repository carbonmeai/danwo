import type { HistoryTest, HistoryTrial, TestHistory, Usage } from "@danwo/runner/runner"
import { describe, expect, it } from "vitest"

import { type KeyPress, listAction } from "../src/lib/list-keys.ts"
import { faultGrid, gridGroups, placeOf } from "../src/modules/matrix/fault-grid.ts"
import { effectDiff } from "../src/modules/record/record-effects.ts"
import { lanesOf, type TimedRecord, timelineOf } from "../src/modules/record/record-timeline.ts"
import { cacheHitRate, healthOf } from "../src/modules/runs/run-trend.ts"

const USAGE: Usage = {
  cache: {},
  spent: { calls: 0, retries: 0, tokens: [0, 0], usd: 0 },
  steps: [],
}

function trial(fault: string | null, status: HistoryTrial["status"]): HistoryTrial {
  return { fault, target: null, status, notes: [], calls: 1, deliveries: 0 }
}

function testRun(
  id: string,
  statuses: readonly HistoryTest["status"][],
  usd = 0,
  durationMs = 1_000,
): TestHistory {
  return {
    version: 1,
    kind: "test",
    id,
    startedAt: `2026-10-18T${id}:00:00.000Z`,
    durationMs,
    usage: {
      ...USAGE,
      cache: { replayed: 3, missed: 1 },
      spent: { ...USAGE.spent, usd, calls: 2 },
    },
    tests: statuses.map((status, i) => ({
      id: `t${i}`,
      status,
      attempts: [],
    })),
    brokenFiles: [],
  }
}

describe("the fault grid", () => {
  it("splits a label into the kind of fault and what it landed on", () => {
    expect(placeOf("status 500 on POST api.stripe.com/v1/charges #2 (poll)")).toEqual({
      column: "status 500",
      row: { target: "POST api.stripe.com/v1/charges #2 (poll)", kind: "call" },
    })
    expect(placeOf("delay 600000ms on webhook invoice.paid")).toEqual({
      column: "delay",
      row: { target: "invoice.paid", kind: "webhook" },
    })
    expect(placeOf("duplicate on stripe webhook checkout.session.completed").row).toEqual({
      target: "stripe checkout.session.completed",
      kind: "webhook",
    })
    expect(placeOf("status 404 on GET a.com/x").column).toBe("status 4xx")
    expect(placeOf("reorder webhooks a, b")).toEqual({
      column: "reorder",
      row: { target: "a, b", kind: "race" },
    })
    expect(placeOf("3 concurrent users").column).toBe("concurrent users")
    expect(placeOf("double-submit on POST /buy").row.kind).toBe("race")
  })

  it("lays trials out by row and column, skipping the clean run, and groups rows by kind", () => {
    const grid = faultGrid([
      trial(null, "passed"),
      trial("duplicate on webhook paid", "failed"),
      trial("reset on POST a.com/x", "passed"),
      trial("status 500 on POST a.com/x", "passed"),
      trial("3 concurrent users", "not-judged"),
    ])

    expect(grid.columns).toEqual(["status 500", "reset", "duplicate", "concurrent users"])
    expect(grid.rows.map((row) => row.target)).toEqual(["paid", "POST a.com/x", "the whole test"])
    expect(grid.cells).toHaveLength(4)
    expect(gridGroups(grid).map((group) => [group.title, group.rows.length])).toEqual([
      ["Provider calls", 1],
      ["Webhooks", 1],
      ["Races and timing", 1],
    ])
  })
})

describe("run health", () => {
  it("adds up pass rate, flaky tests, failed runs and spend, with points oldest first", () => {
    const health = healthOf([
      testRun("12", ["passed", "flaky"], 0.02),
      testRun("11", ["passed", "failed"], 0.01),
    ])

    expect(health).toMatchObject({
      window: 2,
      passRate: 0.75,
      flaky: 1,
      failedRuns: 1,
      modelCalls: 4,
    })
    expect(health.costUsd).toBeCloseTo(0.03)
    expect(health.cacheHitRate).toBe(0.75)
    expect(health.points.map((point) => [point.id, point.passRate])).toEqual([
      ["11", 0.5],
      ["12", 1],
    ])
  })

  it("reads no hit rate when no agent step used the cache", () => {
    expect(cacheHitRate(USAGE)).toBeNull()
  })
})

describe("the record timeline", () => {
  const record: TimedRecord = {
    startedAt: "2026-10-18T10:00:00.000Z",
    steps: [
      {
        index: 0,
        label: "open",
        status: "passed",
        startedAt: "2026-10-18T10:00:00.000Z",
        durationMs: 1_000,
      },
      {
        index: 1,
        label: "check",
        status: "failed",
        startedAt: "2026-10-18T10:00:01.000Z",
        durationMs: 2_000,
      },
    ],
    exchanges: [1_100, 1_500, 1_900].map((ms, i) => ({
      id: `x${i}`,
      method: "GET",
      host: "a.com",
      path: "/poll?n=1",
      startedAt: new Date(Date.parse("2026-10-18T10:00:00.000Z") + ms).toISOString(),
      durationMs: 10,
      status: i === 2 ? 500 : 200,
      aborted: false,
      fault: i === 2 ? "status 500 on GET a.com/poll" : null,
    })),
    deliveries: [],
  }

  it("puts steps and calls on one clock, each call under the step it fell in", () => {
    const timeline = timelineOf(record)

    expect(timeline.spanMs).toBe(3_000)
    expect(timeline.items.map((item) => [item.kind, item.startMs, item.step])).toEqual([
      ["step", 0, 0],
      ["step", 1_000, 1],
      ["call", 1_100, 1],
      ["call", 1_500, 1],
      ["call", 1_900, 1],
    ])
    expect(timeline.items.at(-1)).toMatchObject({
      label: "GET a.com/poll",
      bad: true,
      outcome: "500",
    })
  })

  it("folds a step's calls with the same label into one lane", () => {
    const lanes = lanesOf(timelineOf(record).items)

    expect(lanes.map((lane) => [lane.kind, lane.items.length])).toEqual([
      ["step", 1],
      ["step", 1],
      ["call", 3],
    ])
  })
})

describe("the effects diff", () => {
  it("marks what the recording expected and the replay missed, and what the replay added", () => {
    expect(
      effectDiff({
        kind: "effects",
        at: "",
        result: "diverged",
        expected: { page: { appeared: ["heading Paid"], vanished: [] }, backend: ["POST a.com/x"] },
        observed: { page: { appeared: ["heading Paid", "alert"], vanished: [] }, backend: [] },
      }),
    ).toEqual([
      { area: "page", text: "+ heading Paid", seen: "both" },
      { area: "page", text: "+ alert", seen: "observed" },
      { area: "backend", text: "POST a.com/x", seen: "expected" },
    ])
  })
})

/** A key press on a list, as the hook would describe it. */
function press(key: string, facts: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    modified: false,
    typing: false,
    inFilter: false,
    hasFilter: true,
    onControl: false,
    hasCurrent: true,
    ...facts,
  }
}

describe("list keys", () => {
  it("moves with j and k, opens with Enter and jumps to the filter with /", () => {
    expect(listAction(press("j"))).toBe("next")
    expect(listAction(press("k"))).toBe("previous")
    expect(listAction(press("Enter"))).toBe("open")
    expect(listAction(press("/"))).toBe("focus-filter")
    expect(listAction(press("Escape", { typing: true, inFilter: true }))).toBe("leave-filter")
  })

  it("leaves typing, shortcuts and focused controls alone", () => {
    expect(listAction(press("j", { typing: true }))).toBeUndefined()
    expect(listAction(press("k", { modified: true }))).toBeUndefined()
    expect(listAction(press("Enter", { onControl: true }))).toBeUndefined()
    expect(listAction(press("Enter", { hasCurrent: false }))).toBeUndefined()
    expect(listAction(press("/", { hasFilter: false }))).toBeUndefined()
  })
})
