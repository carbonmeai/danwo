import type { PlannedFault } from "@danwo/matrix"
import { describe, expect, it } from "vitest"

import {
  type CleanCost,
  estimateLine,
  estimateText,
  estimateTrials,
} from "../src/runner/estimate.ts"
import { counted } from "../src/support/counted.ts"

/** A clean run: 1.9 s around a 4 s body, 6 s to start a worker, a 2 s reset and a 0.4 s restore. */
const CLEAN: CleanCost = {
  timings: { prepare: 2000, open: 500, body: 4000, invariant: 200, settle: 300, close: 500 },
  startMs: 6000,
  restoreMs: 400,
}

function duplicate(occurrence: number): PlannedFault {
  return {
    target: "webhook",
    topic: "checkout.session.completed",
    occurrence,
    fault: { kind: "duplicate" },
    label: `duplicate #${occurrence}`,
  }
}

const DELAYED: PlannedFault = {
  target: "webhook",
  topic: "checkout.session.completed",
  occurrence: 0,
  fault: { kind: "delay", ms: 600_000 },
  label: "delay",
}

const DROPPED: PlannedFault = {
  target: "socket",
  route: "WS ws.pusher.test/app/:id",
  occurrence: 0,
  fault: { kind: "reset" },
  label: "dropped socket",
}

describe("matrix plan estimate", () => {
  it("restores between trials and starts every worker but the clean trial's cold", () => {
    const plan = Array.from({ length: 8 }, (_, i) => duplicate(i))

    // Two 5.9 s trials a worker; the three cold workers add their start and reset, less a restore.
    expect(estimateTrials(plan, CLEAN, 4)).toEqual({ lowMs: 19_400, highMs: 19_400 })
  })

  it("resets before every trial when the environment keeps no snapshots", () => {
    const { restoreMs: _restore, ...resetting } = CLEAN
    const plan = Array.from({ length: 4 }, (_, i) => duplicate(i))

    expect(estimateTrials(plan, resetting, 2)).toEqual({ lowMs: 21_000, highMs: 21_000 })
  })

  it("adds a delay fault's delay, as long as a paced check would wait for it", () => {
    const short = { ...DELAYED, fault: { kind: "delay", ms: 800 } } as const

    expect(estimateTrials([short], CLEAN, 8)).toEqual({ lowMs: 6700, highMs: 6700 })
    expect(estimateTrials([DELAYED], CLEAN, 8)).toEqual({ lowMs: 7400, highMs: 15_900 })
  })

  it("lets a breaking fault end its body early", () => {
    expect(estimateTrials([DROPPED], CLEAN, 1)).toEqual({ lowMs: 2900, highMs: 5900 })
  })

  it("estimates nothing for an empty plan", () => {
    expect(estimateTrials([], CLEAN, 4)).toEqual({ lowMs: 0, highMs: 0 })
  })

  it("says a range in seconds or minutes", () => {
    expect(estimateText({ lowMs: 180_000, highMs: 300_000 })).toBe("about 3–5 min")
    expect(estimateText({ lowMs: 40_000, highMs: 70_000 })).toBe("about 40–70 s")
    expect(estimateText({ lowMs: 19_400, highMs: 19_400 })).toBe("about 19 s")
  })

  it("counts one trial on one worker in the singular", () => {
    expect(estimateLine([DROPPED], CLEAN, 1)).toBe("about 3–6 s for 1 trial on 1 worker")
    expect(estimateLine([duplicate(0), duplicate(1)], CLEAN, 2)).toBe(
      "about 14 s for 2 trials on 2 workers",
    )
  })
})

describe("a count with its noun", () => {
  it("is singular for one and plural otherwise", () => {
    expect(counted(1, "worker")).toBe("1 worker")
    expect(counted(2, "worker")).toBe("2 workers")
    expect(counted(0, "test")).toBe("0 tests")
  })
})
