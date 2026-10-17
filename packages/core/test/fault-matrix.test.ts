import assert from "node:assert/strict"
import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  createEmulator,
  type Emulator,
  ManualClock,
  seedStripe,
  stripe,
  stripeOutboundFaults,
  type WebhookDispatcher,
} from "@danwo/emulators"
import { type Proxy, startProxy } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { formatMatrix, type RunEnvironment, runFaultMatrix } from "../src/fault-matrix.ts"

const SHOP = fileURLToPath(new URL("../../../examples/shop/src/server.ts", import.meta.url))
const WEBHOOK_SECRET = "whsec_shop_test"

interface ShopEnvironment extends RunEnvironment {
  readonly proxy: Proxy
  readonly webhooks: WebhookDispatcher
  readonly emulator: Emulator
  readonly clock: ManualClock
  readonly shopUrl: string
}

/** Starts the shop as its own process, routed through the proxy like any unmodified app. */
async function startShop(env: NodeJS.ProcessEnv): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [SHOP], { env, stdio: ["ignore", "pipe", "pipe"] })
  const port = await new Promise<string>((resolve, reject) => {
    let out = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString()
      const match = /listening (\d+)/.exec(out)

      if (match?.[1]) resolve(match[1])
    })
    child.once("exit", (code) => reject(new Error(`shop exited with ${code}`)))
  })

  return { url: `http://127.0.0.1:${port}`, child }
}

function shopEnvironment(bug?: "no-dedupe"): () => Promise<ShopEnvironment> {
  return async () => {
    const clock = new ManualClock(new Date())
    const emulator = createEmulator(stripe, {
      clock: clock.clock,
      timer: clock.timer,
      baseUrl: "https://checkout.stripe.com",
    })
    const proxy = await startProxy({
      routes: [{ hosts: ["api.stripe.com", "checkout.stripe.com"], handler: emulator.fetch }],
    })
    const shop = await startShop(
      proxy.env({
        ...process.env,
        STRIPE_SECRET_KEY: "sk_test_shop",
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        PORT: "0",
        ...(bug && { SHOP_BUG: bug }),
      }),
    )

    seedStripe(emulator.store, {
      webhookEndpoints: [
        {
          url: `${shop.url}/webhooks/stripe`,
          events: ["checkout.session.completed"],
          secret: WEBHOOK_SECRET,
        },
      ],
    })

    return {
      proxy,
      webhooks: emulator.webhooks!,
      emulator,
      clock,
      shopUrl: shop.url,
      async close() {
        shop.child.kill()
        await proxy.stop()
        await emulator.close()
      },
    }
  }
}

/** Plays every pending webhook delivery and retry to the end. */
async function settleWebhooks(env: ShopEnvironment): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await env.webhooks.idle()
    const next = env.clock.nextIn()

    if (next === undefined) return
    env.clock.advance(next)
  }

  throw new Error("webhook deliveries did not settle")
}

async function credits(env: ShopEnvironment, user: string): Promise<number> {
  const res = await fetch(`${env.shopUrl}/credits?user=${user}`)

  return ((await res.json()) as { credits: number }).credits
}

/**
 * Buy 500 credits: start a checkout, pay on the hosted page, let webhooks settle. The user ends
 * with exactly 500 credits, or the shop reports that checkout could not start and grants nothing.
 */
async function buyCredits(env: ShopEnvironment): Promise<void> {
  const res = await fetch(`${env.shopUrl}/buy`, {
    method: "POST",
    body: JSON.stringify({ user: "u1", amount: 500 }),
  })

  if (res.status !== 200) {
    assert.equal(res.status, 502, "a failed checkout must be reported as 502")
    assert.equal(await credits(env, "u1"), 0, "no credits without a payment")

    return
  }

  const { url } = (await res.json()) as { url: string }
  const sessionId = new URL(url).pathname.split("/").at(-1) ?? ""

  await env.emulator.fetch(
    new Request(`${env.emulator.baseUrl}/checkout/${sessionId}/complete`, { method: "POST" }),
  )
  await settleWebhooks(env)
  assert.equal(await credits(env, "u1"), 500, "credits granted exactly once")
}

const webhookFaults = [
  { kind: "duplicate" },
  { kind: "delay", ms: 10 * 60_000 },
  { kind: "forged" },
  { kind: "stale", seconds: 3600 },
] as const

describe("fault matrix on buying credits", () => {
  it("passes the shop under every single fault", async () => {
    const result = await runFaultMatrix({
      environment: shopEnvironment(),
      journey: buyCredits,
      outboundFaults: stripeOutboundFaults,
      webhookFaults,
      concurrency: 4,
    })
    const report = formatMatrix(result)

    expect(result.clean.status, report).toBe("passed")
    expect(result.runs.map((r) => r.fault?.label)).toEqual([
      "status 500 on POST api.stripe.com/v1/checkout/sessions",
      "status 429 on POST api.stripe.com/v1/checkout/sessions",
      "reset on POST api.stripe.com/v1/checkout/sessions",
      "reset-after on POST api.stripe.com/v1/checkout/sessions",
      "duplicate on webhook checkout.session.completed",
      "delay 600000ms on webhook checkout.session.completed",
      "forged on webhook checkout.session.completed",
      "stale 3600s on webhook checkout.session.completed",
    ])
    expect(
      result.runs.filter((r) => r.status !== "passed"),
      report,
    ).toEqual([])
    // Each outbound fault is visible on the exchange it hit.
    const first = result.runs[0]?.exchanges[0]

    expect(first).toMatchObject({ status: 500, fault: "status 500" })
  }, 60_000)

  it("catches a shop that grants credits twice for a duplicated webhook", async () => {
    const result = await runFaultMatrix({
      environment: shopEnvironment("no-dedupe"),
      journey: buyCredits,
      outboundFaults: stripeOutboundFaults,
      webhookFaults,
      concurrency: 4,
    })
    const failed = result.runs.filter((r) => r.status !== "passed")

    expect(
      failed.map((r) => r.fault?.label),
      formatMatrix(result),
    ).toEqual(["duplicate on webhook checkout.session.completed"])
    expect(failed[0]?.error).toContain("credits granted exactly once")
  }, 60_000)

  it("reports a run whose fault never fired as invalid, and reruns it when asked", async () => {
    let runs = 0

    // Buys only on odd runs: the clean run plans faults that the next run never meets.
    const sometimes = async (env: ShopEnvironment) => {
      runs += 1

      if (runs % 2 === 1) await buyCredits(env)
    }

    const invalid = await runFaultMatrix({
      environment: shopEnvironment(),
      journey: sometimes,
      outboundFaults: stripeOutboundFaults,
      webhookFaults,
    })
    const report = formatMatrix(invalid)

    expect(invalid.runs.filter((r) => r.status === "invalid").length, report).toBe(
      invalid.runs.length / 2,
    )
    expect(invalid.runs[0]?.error).toContain("the fault never fired")
    expect(report).toMatch(
      /^INVALID {2}status 500 on POST api\.stripe\.com\/v1\/checkout\/sessions$/m,
    )
    expect(report).toContain("invalid (fault never fired)")

    runs = 0
    const rerun = await runFaultMatrix({
      environment: shopEnvironment(),
      journey: sometimes,
      outboundFaults: stripeOutboundFaults,
      webhookFaults,
      rerunInvalid: 1,
    })

    expect(
      rerun.runs.filter((r) => r.status !== "passed"),
      formatMatrix(rerun),
    ).toEqual([])
  }, 120_000)
})
