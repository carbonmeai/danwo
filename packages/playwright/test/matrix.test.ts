import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PlannedFault } from "@danwo/matrix"
import { describe, expect, it } from "vitest"

import { startWorkerSetup } from "../src/environment.ts"
import { judgeTrial } from "../src/matrix.ts"
import { readOutcomes, type TestOutcome } from "../src/protocol.ts"

/** A live-looking Stripe key, put together at runtime so no scanner takes the source for one. */
const LIVE_KEY = ["sk_", "live_abcdefghijklmnop"].join("")

const exchange = {
  disposition: "routed" as const,
  method: "POST",
  host: "api.stripe.com",
  path: "/v1/checkout/sessions",
  startedAt: "2026-01-01T00:00:00.000Z",
  id: "1",
  fault: null,
  status: 200,
  durationMs: 3,
  aborted: false,
}

function outcome(overrides: Partial<TestOutcome> = {}): TestOutcome {
  return {
    title: "buys credits",
    file: "tests/buy.spec.ts",
    body: "passed",
    bodyError: null,
    invariant: { error: null },
    line: null,
    exchanges: [exchange],
    deliveries: [],
    record: null,
    ...overrides,
  }
}

const fault: PlannedFault = {
  target: "outbound",
  call: { method: "POST", host: "api.stripe.com", path: "/v1/checkout/sessions", index: 0 },
  route: "POST api.stripe.com/v1/checkout/sessions",
  occurrence: 0,
  fault: { kind: "reset" },
  label: "reset on POST api.stripe.com/v1/checkout/sessions",
}
const faulted = { ...exchange, fault: "reset" }

describe("judging a Playwright trial", () => {
  it("needs body and invariant to hold on the clean run", () => {
    expect(judgeTrial(null, outcome()).status).toBe("passed")
    expect(judgeTrial(null, outcome({ invariant: { error: "expected 1 to be 2" } }))).toMatchObject(
      {
        status: "failed",
        error: "invariant: expected 1 to be 2",
      },
    )
    expect(
      judgeTrial(null, outcome({ body: "failed", bodyError: "Error: boom\n  at x" })),
    ).toMatchObject({
      status: "failed",
      error: "Error: boom",
    })
  })

  it("judges a faulted run by its invariant and notes where the body stopped", () => {
    const run = judgeTrial(
      fault,
      outcome({
        body: "failed",
        bodyError:
          "Error: expect(locator).toBeVisible() failed\nExpected: visible\nReceived: hidden",
        line: 17,
        exchanges: [faulted],
      }),
    )

    expect(run).toMatchObject({
      status: "passed",
      error: null,
      notes: [
        "body stopped at tests/buy.spec.ts:17: Error: expect(locator).toBeVisible() failed · Expected: visible · Received: hidden",
      ],
    })
  })

  it("needs the body to pass under the fault when the test declares no invariant", () => {
    const run = judgeTrial(
      fault,
      outcome({ body: "failed", bodyError: "Error: boom", invariant: null, exchanges: [faulted] }),
    )

    expect(run).toMatchObject({ status: "failed", error: "Error: boom" })
  })

  it("calls a faulted run invalid when its fault never fired", () => {
    expect(judgeTrial(fault, outcome()).status).toBe("invalid")
  })
})

describe("the outcome file", () => {
  it("reads one test outcome per line and refuses a malformed one", () => {
    const text = `${JSON.stringify(outcome())}\n\n${JSON.stringify(outcome({ title: "second" }))}\n`

    expect(readOutcomes(text).map((o) => o.title)).toEqual(["buys credits", "second"])
    expect(() => readOutcomes('{"title":1}\n')).toThrow(/expected string/)
  })
})

describe("starting a worker's environment", () => {
  it("starts the inline environment and knows the config's secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-pw-setup-"))

    try {
      await writeFile(
        join(dir, "danwo.config.ts"),
        `export default { secrets: { key: { value: "${LIVE_KEY}", purpose: "api-key" } } }\n`,
      )

      const closed: number[] = []
      const setup = await startWorkerSetup({
        cwd: dir,
        workerIndex: 3,
        environment: async ({ workerIndex }) => ({
          baseUrl: `http://127.0.0.1:${4000 + workerIndex}`,
          close: async () => {
            closed.push(workerIndex)
          },
        }),
      })

      expect(setup.env.baseUrl).toBe("http://127.0.0.1:4003")
      expect(setup.vault.redact(`key ${LIVE_KEY}`)).not.toContain("abcdefghij")
      await setup.env.close()
      expect(closed).toEqual([3])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("says what is missing when there is no environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-pw-setup-"))

    try {
      await expect(startWorkerSetup({ cwd: dir, workerIndex: 0 })).rejects.toThrow(
        /no danwo environment: give the danwoEnvironment option/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
