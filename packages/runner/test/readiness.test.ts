import type { Exchange, Proxy } from "@danwo/proxy"
import type { Page } from "playwright-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { type Backend, Readiness } from "../src/browser/readiness.ts"
import { backendOf } from "../src/runner/backend.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"

/** A page whose DOM is always quiet, counting the DOM-quiet waits run on it. */
function quietPage(): { page: Page; waits: () => number } {
  let waits = 0
  const page = {
    waitForLoadState: async () => undefined,
    evaluate: async () => {
      waits += 1
    },
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: readiness only loads and evaluates
  return { page: page as unknown as Page, waits: () => waits }
}

describe("readiness after an action", () => {
  it("does not wait for the page a second time when the backend did nothing", async () => {
    const { page, waits } = quietPage()
    const backend: Backend = { quiet: async () => undefined, pulse: () => 7 }

    await new Readiness({ mode: "page+backend", backend }).after(page)
    expect(waits()).toBe(1)
  })

  it("waits for the page again once the backend answered something", async () => {
    const { page, waits } = quietPage()
    let pulse = 0
    const backend: Backend = {
      quiet: async () => {
        pulse += 2
      },
      pulse: () => pulse,
    }

    await new Readiness({ mode: "page+backend", backend }).after(page)
    expect(waits()).toBe(2)
  })

  it("waits for the page again when the backend cannot say what it did", async () => {
    const { page, waits } = quietPage()

    await new Readiness({ mode: "page+backend", backend: { quiet: async () => undefined } }).after(
      page,
    )
    expect(waits()).toBe(2)
  })
})

/** An environment whose proxy has seen `calls`, all of them finished unless marked open. */
function environment(calls: Exchange[]): WorkerEnvironment {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the backend reads only the exchange log
  const proxy = { exchanges: () => calls, settled: async () => undefined } as unknown as Proxy

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the backend needs only the proxy
  return { proxy } as unknown as WorkerEnvironment
}

function call(status: number | null): Exchange {
  return {
    disposition: "routed",
    method: "GET",
    host: "api.example.test",
    path: "/",
    startedAt: new Date().toISOString(),
    id: String(Math.random()),
    fault: null,
    status,
    durationMs: null,
    aborted: false,
  }
}

/** Whether `promise` has settled once pending callbacks ran, without moving the clock. */
async function settledNow(promise: Promise<unknown>): Promise<boolean> {
  let done = false

  void promise.then(() => (done = true))
  await vi.advanceTimersByTimeAsync(0)

  return done
}

describe("the backend's quiet", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("pauses for follow-up deliveries only while something happened just now", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] })

    const calls = [call(200)]
    const backend = backendOf(environment(calls))

    /* First look: what it sees is new, so it pauses for what that call may have queued. */
    const first = backend?.quiet(1_000) ?? Promise.resolve()

    expect(await settledNow(first)).toBe(false)
    await vi.advanceTimersByTimeAsync(25)
    expect(await settledNow(first)).toBe(true)

    /* Nothing started or finished since: no pause. */
    await vi.advanceTimersByTimeAsync(30)
    expect(await settledNow(backend?.quiet(1_000) ?? Promise.resolve())).toBe(true)

    /* A call that finished since brings the pause back. */
    const open = call(null)

    calls.push(open)
    await settledNow(backend?.quiet(1_000) ?? Promise.resolve())
    await vi.advanceTimersByTimeAsync(30)
    open.status = 200

    expect(await settledNow(backend?.quiet(1_000) ?? Promise.resolve())).toBe(false)
  })
})
