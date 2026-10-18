import {
  createEmulator,
  type EmulatorDefinition,
  type Entity,
  github,
  google,
  ManualClock,
  microsoft,
  resend,
  s3,
  slack,
  stripe,
} from "@danwo/emulators"
import { describe, expect, it } from "vitest"

import { checkKey, pacedTimeout, paceOf } from "../src/assert/pace.ts"
import type { StepRecord } from "../src/record/steps.ts"
import { keptEmulator } from "../src/runner/services.ts"
import { stripeService } from "../src/runner/stripe.ts"
import { medianTimings, noTimings, timingsLine } from "../src/runner/timings.ts"
import { runPool, shuffledOrder } from "../src/runner/trial-pool.ts"

/** A step record with only what pacing reads. */
function step(index: number, api: string, status: StepRecord["status"], ms: number): StepRecord {
  return {
    id: `s${index}`,
    index,
    kind: api.startsWith("expect") ? "assertion" : "locator",
    api,
    label: `label ${index}`,
    status,
    startedAt: new Date(0).toISOString(),
    durationMs: ms,
    events: [],
  }
}

describe("check pace", () => {
  it("keeps the time of every check that passed, keyed by index, API and call", () => {
    const steps = [
      step(0, "locator.click", "passed", 300),
      step(1, "expect.toBeVisible", "passed", 40),
      step(2, "expect.toHaveText", "failed", 10_000),
    ]

    expect(paceOf(steps)).toEqual({ [checkKey(1, "expect.toBeVisible", "label 1")]: 40 })
  })

  it("bounds a known check by its clean time, scaled, within the normal timeout", () => {
    const pace = { took: { a: 20, b: 3000, c: 9000 } }

    expect(pacedTimeout(pace, "a", 10_000)).toBe(1500)
    expect(pacedTimeout(pace, "b", 10_000)).toBe(9500)
    expect(pacedTimeout(pace, "c", 10_000)).toBe(10_000)
    expect(pacedTimeout(pace, "unknown", 10_000)).toBe(10_000)
    expect(pacedTimeout({ ...pace, factor: 1, floorMs: 200 }, "a", 10_000)).toBe(700)
  })
})

describe("trial timings", () => {
  it("prints each phase's median and the median total", () => {
    const fast = { ...noTimings(), prepare: 2, body: 1000, close: 40 }
    const slow = { ...noTimings(), prepare: 4, body: 3000, close: 60 }
    const mid = { ...noTimings(), prepare: 3, body: 2000, close: 50 }

    expect(medianTimings([fast, slow, mid]).body).toBe(2000)
    expect(timingsLine([fast, slow, mid])).toBe(
      "trial time (median of 3): 2053 ms · prepare 3 ms · open 0 ms · body 2000 ms · invariant 0 ms · settle 0 ms · close 50 ms",
    )
    expect(timingsLine([])).toBeUndefined()
  })
})

describe("the trial pool", () => {
  it("runs at most `size` at once and returns results in the items' order", async () => {
    let running = 0
    let peak = 0
    const results = await runPool(
      [30, 10, 20, 5, 15],
      async (ms) => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, ms))
        running--

        return ms * 2
      },
      () => false,
      { size: 2 },
    )

    expect(results).toEqual([60, 20, 40, 10, 30])
    expect(peak).toBe(2)
  })

  it("starts items in the given order", async () => {
    const started: number[] = []

    await runPool(
      ["a", "b", "c"],
      async (item) => {
        started.push(["a", "b", "c"].indexOf(item))

        return item
      },
      () => false,
      { size: 1, order: [2, 0, 1] },
    )

    expect(started).toEqual([2, 0, 1])
  })

  it("starts no new item once enough failed", async () => {
    const results = await runPool(
      [1, 2, 3, 4, 5],
      async (n) => n,
      (n) => n <= 2,
      { size: 1, stopAfter: 2 },
    )

    expect(results).toEqual([1, 2, undefined, undefined, undefined])
  })

  it("shuffles the same way for the same seed, and every index once", () => {
    const order = shuffledOrder(15, 42)

    expect(shuffledOrder(15, 42)).toEqual(order)
    expect(order.toSorted((a, b) => a - b)).toEqual([...Array.from({ length: 15 }).keys()])
    expect(shuffledOrder(15, 7)).not.toEqual(order)
  })
})

const EMULATORS: readonly (readonly [string, EmulatorDefinition])[] = [
  ["stripe", stripe],
  ["resend", resend],
  ["s3", s3],
  ["google", google],
  ["microsoft", microsoft],
  ["slack", slack],
  ["github", github],
]

describe("kept emulator state", () => {
  for (const [name, definition] of EMULATORS) {
    it(`puts the ${name} emulator's store back exactly as it was kept`, async () => {
      const emulator = createEmulator(definition)
      const kept = keptEmulator(emulator)
      const before = emulator.snapshot()
      const names = Object.keys(before.collections)

      await kept.snapshot()
      for (const collection of names) emulator.store.collection<Entity>(collection).insert({})
      emulator.store.setData({ name: "danwo.test.marker" }, 1)
      expect(emulator.snapshot()).not.toEqual(before)

      await kept.restore()
      expect(emulator.snapshot()).toEqual(before)
      await emulator.close()
    })
  }

  it("drops webhook deliveries scheduled before the restore", async () => {
    const service = stripeService({
      seed: () => ({
        webhookEndpoints: [
          { url: "http://127.0.0.1:9/hooks", events: ["customer.created"], secret: "whsec_x" },
        ],
      }),
    })

    await service.snapshot?.()
    await service.emulator.fetch(
      new Request("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: { authorization: "Bearer sk_test_kept" },
        body: new URLSearchParams({ email: "ada@danwo.test" }),
      }),
    )
    await service.emulator.webhooks?.idle()
    expect(service.clock.nextIn()).not.toBeUndefined()

    await service.restore?.()
    expect(service.clock.nextIn()).toBeUndefined()
    expect(service.emulator.store.collection<Entity>("customers").all()).toEqual([])
    await service.close()
  })

  it("cancels every callback on a manual clock", () => {
    const clock = new ManualClock(new Date(0))
    let ran = false

    clock.timer.setTimeout(() => (ran = true), 10)
    clock.cancelAll()
    clock.advance(100)
    expect(ran).toBe(false)
  })
})
