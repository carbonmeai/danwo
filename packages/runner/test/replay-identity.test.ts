/**
 * Which app a recording belongs to: an app on this machine is the same app whatever free port a
 * run started it on, so its recordings replay on the next run.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSessionOptions } from "../src/index.ts"
import { judging, verdict } from "./fixtures/judging.ts"
import { startOrdersSite } from "./fixtures/orders-site.ts"
import { ref, scripted } from "./fixtures/scripted.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-identity-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Pays on a fresh orders site (its own free port) and waits for the payment to show. */
async function payOnNewSite(models: Pick<WebSessionOptions, "model" | "judge">) {
  const site = await startOrdersSite()
  const session = await openWebSession({
    baseUrl: site.url,
    cache: { dir, mode: "read-write", journey: "identity" },
    ...models,
  })

  try {
    await session.app.open("/")
    await session.agent.act("pay for the order")
    await session.agent.waitFor("the payment went through", { interval: 100 })

    return session.flight.steps().map((step) => step.cache?.mode)
  } finally {
    await session.close()
    await site.close()
  }
}

describe("recordings of an app on this machine", { timeout: 30_000 }, () => {
  it("replay with no model when the next run starts the app on another port", async () => {
    await payOnNewSite({
      model: scripted([(view) => ["click", { ref: ref(view, "button", "Pay") }]]),
      judge: judging([
        (page) =>
          page.includes("Payment received")
            ? verdict("holds", "Payment received")
            : verdict("fails"),
      ]),
    })

    const idle = scripted([])
    const silent = judging([verdict("fails")])
    const modes = await payOnNewSite({ model: idle, judge: silent })

    expect(modes.filter((mode) => mode !== undefined)).toEqual(["replayed", "replayed"])
    expect(idle.doGenerateCalls).toHaveLength(0)
    expect(silent.doGenerateCalls).toHaveLength(0)
  })
})
