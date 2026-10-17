/**
 * Waiting and failing well: `agent.waitFor` and a polling `agent.assert`, waiting after each action
 * for the page and the backend, stopping a step the app failed in, and asking the model again
 * when its answer could not be used.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Backend } from "../src/browser/readiness.ts"
import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { classOf, codeOf } from "../src/support/codes.ts"
import type { HtmlServer } from "./fixtures/html-server.ts"
import { judging, verdict } from "./fixtures/judging.ts"
import { startOrdersSite } from "./fixtures/orders-site.ts"
import { call, ref, scripted } from "./fixtures/scripted.ts"

let site: HtmlServer
let dir: string

beforeAll(async () => {
  site = await startOrdersSite()
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-waits-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function withSession<T>(
  options: Partial<WebSessionOptions> & { readonly path?: string },
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const { path = "/", ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    cache: { dir, mode: "read-write", journey: "waits" },
    ...rest,
  })

  try {
    await session.app.open(path)

    return await run(session)
  } finally {
    await session.close()
  }
}

/** A judge that sees the payment only once the page shows it. */
const paymentJudge = () =>
  judging([
    (page) =>
      page.includes("Payment received") ? verdict("holds", "Payment received") : verdict("fails"),
  ])

/** A model that fails the test if it is ever asked. */
function silent() {
  return judging([verdict("fails")])
}

const PAY = scripted([(view) => ["click", { ref: ref(view, "button", "Pay") }]])

describe("agent.waitFor", () => {
  it("polls the judge until the condition holds, then replays by its evidence with no model", async () => {
    const judge = paymentJudge()

    await withSession({ model: PAY, judge }, async (session) => {
      await session.agent.act("pay for the order")
      await session.agent.waitFor("the payment went through", { interval: 100 })
    })

    expect(judge.pages.length).toBeGreaterThan(1)

    const replayJudge = silent()
    const idle = scripted([])

    await withSession({ model: idle, judge: replayJudge }, async (session) => {
      await session.agent.act("pay for the order")
      await session.agent.waitFor("the payment went through", { interval: 100 })

      const wait = session.flight.steps().find((step) => step.api === "agent.waitFor")

      expect(wait?.cache?.mode).toBe("replayed")
    })

    expect(idle.doGenerateCalls).toHaveLength(0)
    expect(replayJudge.doGenerateCalls).toHaveLength(0)
  })

  it("fails with WAIT_TIMED_OUT when the condition never holds", async () => {
    const judge = judging([verdict("fails")])

    await withSession({ model: scripted([]), judge }, async (session) => {
      const waiting = session.agent.waitFor("the order is refunded", {
        timeout: 400,
        interval: 100,
      })

      await expect(waiting).rejects.toMatchObject({ code: "WAIT_TIMED_OUT" })
    })
  })

  it("diverges under strict replay when the recorded evidence never shows", async () => {
    await withSession({ model: PAY, judge: paymentJudge() }, async (session) => {
      await session.agent.act("pay for the order")
      await session.agent.waitFor("the payment went through", { interval: 100 })
    })

    await withSession(
      { model: scripted([]), path: "/crash", replay: { mode: "strict-stop" } },
      async (session) => {
        await session.agent.waitFor("the payment went through", { timeout: 300 }).catch(() => {})

        expect(session.divergence()?.reason).toMatch(/was not shown within/)
      },
    )
  })
})

describe("agent.assert with poll", () => {
  it("asks again until the claim holds, where a single look fails", async () => {
    await withSession({ model: scripted([]), judge: paymentJudge() }, async (session) => {
      await session.screen.getByRole("button", { name: "Pay" }).click()

      await expect(session.agent.assert("the payment went through")).rejects.toMatchObject({
        code: "CLAIM_FAILED",
      })
      await session.agent.assert("the payment went through", {
        poll: { timeout: 3_000, interval: 100 },
      })
    })
  })
})

/** A model answer with words but no tool call. */
function prose(): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: "I would click the Pay button now." }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  }
}

describe("unusable model answers", () => {
  it("asks again after an answer with no tool call, and counts the retry", async () => {
    let turn = 0
    const actor = new MockLanguageModelV4({
      doGenerate: async () => {
        turn++

        return turn === 1 ? prose() : call("done", { status: "passed", summary: "looked" })
      },
    })

    await withSession({ model: actor }, async (session) => {
      await session.agent.act("look around")

      const step = session.flight.steps().find((entry) => entry.api === "agent.act")
      const retries = step?.events.filter((event) => event.kind === "model" && event.retry)

      expect(retries).toHaveLength(1)
    })
  })

  it("gives up with MODEL_OUTPUT_INVALID, which is inconclusive, after three unusable answers", async () => {
    const actor = new MockLanguageModelV4({ doGenerate: async () => prose() })

    await withSession({ model: actor }, async (session) => {
      const error: unknown = await session.agent.act("pay for the order").catch((e: unknown) => e)

      expect(codeOf(error)).toBe("MODEL_OUTPUT_INVALID")
      expect(classOf(codeOf(error))).toBe("inconclusive")
      expect(actor.doGenerateCalls).toHaveLength(3)
    })
  })

  it("asks the judge again when its answer holds no verdict", async () => {
    const judge = judging(["Looks fine to me.", "Sure.", verdict("holds")])

    await withSession({ model: scripted([]), judge }, async (session) => {
      await session.agent.assert("the orders page is shown")
    })

    expect(judge.doGenerateCalls).toHaveLength(3)

    const stubborn = judging(["no idea"])

    await withSession({ model: scripted([]), judge: stubborn }, async (session) => {
      await expect(session.agent.assert("the orders page is shown")).rejects.toMatchObject({
        code: "MODEL_OUTPUT_INVALID",
      })
    })
  })
})

describe("app failures during a step", () => {
  const CHARGE_THEN_DONE = scripted([
    (view) => ["click", { ref: ref(view, "button", "Charge card") }],
  ])

  it("stops a live step at the app's 5xx with APP_ERROR and keeps no recording", async () => {
    await withSession({ model: CHARGE_THEN_DONE }, async (session) => {
      await expect(session.agent.act("charge the card")).rejects.toMatchObject({
        code: "APP_ERROR",
        message: expect.stringMatching(/500 from .*\/api\/charge/),
      })

      const step = session.flight.steps().find((entry) => entry.api === "agent.act")

      expect(step?.events.some((event) => event.kind === "app-error")).toBe(true)
    })

    expect(CHARGE_THEN_DONE.doGenerateCalls).toHaveLength(1)
  })

  it("names a provider call that failed first as PROVIDER_ERROR", async () => {
    const failures: string[] = []
    const backend: Backend = {
      quiet: async () => {
        failures.push("POST api.stripe.com/v1/charges → 500")
      },
      failures: () => failures,
    }

    await withSession(
      {
        model: scripted([(view) => ["click", { ref: ref(view, "button", "Charge card") }]]),
        backend,
      },
      async (session) => {
        await expect(session.agent.act("charge the card")).rejects.toMatchObject({
          code: "PROVIDER_ERROR",
          message: expect.stringMatching(/api\.stripe\.com\/v1\/charges/),
        })
      },
    )
  })

  it("counts an uncaught page error", async () => {
    const actor = scripted([(view) => ["click", { ref: ref(view, "button", "Crash") }]])

    await withSession({ model: actor, path: "/crash" }, async (session) => {
      await expect(session.agent.act("press crash")).rejects.toMatchObject({
        code: "APP_ERROR",
        message: expect.stringMatching(/boom from the page/),
      })
    })
  })
})

describe("readiness after actions", () => {
  it("waits for the backend after each action and records how long", async () => {
    let quietCalls = 0
    const backend: Backend = {
      quiet: async () => {
        quietCalls++
        await new Promise((resolve) => setTimeout(resolve, 150))
      },
    }

    await withSession({ backend }, async (session) => {
      await session.screen.getByRole("button", { name: "Pay" }).click()

      const click = session.flight.steps().find((step) => step.api === "locator.click")
      const ready = click?.events.find((event) => event.kind === "ready")

      expect(ready).toMatchObject({ waited: "page+backend" })
      expect(ready?.kind === "ready" && ready.ms).toBeGreaterThanOrEqual(150)
    })

    expect(quietCalls).toBeGreaterThanOrEqual(2)
  })

  it("waits on nothing when readiness is off", async () => {
    await withSession({ readiness: "off" }, async (session) => {
      await session.screen.getByRole("button", { name: "Pay" }).click()

      const click = session.flight.steps().find((step) => step.api === "locator.click")

      expect(click?.events.some((event) => event.kind === "ready")).toBe(false)
    })
  })
})
