import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import {
  describeWebhookFault,
  ManualClock,
  stripeOutboundFaults,
  type WebhookDispatcher,
} from "@danwo/emulators"
import {
  formatMatrix,
  type FaultMatrixResult,
  type RunEnvironment,
  runFaultMatrix,
} from "@danwo/matrix"
import { describeOutboundFault, type Proxy } from "@danwo/proxy"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { openWebSession, type WebSession } from "../src/session.ts"
import { type ShopEnvironment, startShopEnvironment } from "./environment.ts"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function toolCall(toolName: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${toolName}-${Math.random()}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  }
}

function promptText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(promptText).join("\n")
  if (value && typeof value === "object") return Object.values(value).map(promptText).join("\n")

  return ""
}

/**
 * The clean run's actor: clicks whichever of the journey's buttons is on screen (the shop's
 * "Buy 500 credits", then Stripe Checkout's "Pay $5.00"), and ends the step once it has clicked.
 */
function scriptedActor(): MockLanguageModelV4 {
  const buttons = [
    /- button "Buy 500 credits"[^\n]*?\[ref=([a-z0-9]+)\]/,
    /- button "Pay \$[\d.]+"[^\n]*?\[ref=([a-z0-9]+)\]/,
  ]

  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted-actor",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const clicked = options.prompt.some(
        (message) =>
          message.role === "tool" &&
          message.content.some((part) => "toolName" in part && part.toolName === "click"),
      )

      if (clicked) return toolCall("done", { status: "passed", summary: "clicked" })
      const text = promptText(options.prompt.filter((m) => m.role !== "system"))

      for (const button of buttons) {
        const id = button.exec(text)?.[1]

        if (id) return toolCall("click", { ref: id })
      }

      throw new Error("scripted actor: neither journey button is on screen")
    },
  })
}

/** The faulted runs' model: replays must never call it. */
function refusingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "replay-only",
    doGenerate: async () => {
      throw new Error("replay-only run: the model must not be called")
    },
  })
}

interface BrowserRun extends RunEnvironment {
  readonly proxy: Proxy
  readonly webhooks: WebhookDispatcher
  readonly shop: ShopEnvironment
  readonly session: WebSession
  readonly clock: ManualClock
  readonly clean: boolean
}

/**
 * One run: a fresh shop, emulator and proxy on a manual clock, and a browser session. The clean
 * run records its agent steps with the scripted actor; faulted runs replay them strictly and
 * stop acting at the first divergence.
 */
function environment(recordings: string, refusing: MockLanguageModelV4, bug?: string) {
  return async ({ fault }: { fault: unknown }): Promise<BrowserRun> => {
    const clean = fault === null
    const clock = new ManualClock(new Date())
    const shop = await startShopEnvironment({
      clock,
      ...(bug === undefined ? {} : { shopEnv: { SHOP_BUG: bug } }),
    })

    try {
      const session = await openWebSession({
        baseUrl: shop.shopUrl,
        proxy: shop.proxy,
        model: clean ? scriptedActor() : refusing,
        cache: {
          dir: recordings,
          mode: clean ? "read-write" : "read-only",
          journey: "buy credits",
          appIdentity: "shop",
        },
        ...(clean ? {} : { replay: { mode: "strict-stop" as const } }),
        assertionTimeout: 5_000,
        actionTimeout: 5_000,
      })

      return {
        proxy: shop.proxy,
        webhooks: shop.emulator.webhooks!,
        shop,
        session,
        clock,
        clean,
        notes() {
          const d = session.divergence()

          return d ? [`diverged at step ${d.step} (${d.instruction}): ${d.reason}`] : []
        },
        async close() {
          await session.close()
          await shop.close()
        },
      }
    } catch (cause) {
      await shop.close()
      throw cause
    }
  }
}

/** Plays every pending webhook delivery and retry to the end on the run's manual clock. */
async function settleWebhooks(run: BrowserRun): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await run.webhooks.idle()
    const next = run.clock.nextIn()

    if (next === undefined) return
    run.clock.advance(next)
  }

  throw new Error("webhook deliveries did not settle")
}

async function shopCredits(run: BrowserRun): Promise<number> {
  const res = await fetch(`${run.shop.shopUrl}/credits?user=u1`)

  return z.object({ credits: z.number() }).parse(await res.json()).credits
}

/** Checkout Sessions Stripe (the emulator) actually marked paid for the user. */
async function paidPayments(run: BrowserRun): Promise<number> {
  const res = await run.shop.emulator.fetch(
    new Request("https://api.stripe.com/v1/checkout/sessions?payment_status=paid&limit=100", {
      headers: { Authorization: "Bearer sk_test_oracle" },
    }),
  )
  const list = z
    .object({ data: z.array(z.object({ client_reference_id: z.string().nullable() })) })
    .parse(await res.json())

  return list.data.filter((s) => s.client_reference_id === "u1").length
}

/**
 * Buy 500 credits in the browser: the shop's button, then Stripe Checkout's pay button. Whatever
 * happened on the way, the shop's credits must match what Stripe captured: paid once and 500
 * credits, or nothing paid and 0 credits.
 */
async function buyCredits(run: BrowserRun): Promise<void> {
  const { session } = run

  await session.app.open("/")
  await session.agent.act("buy 500 credits")
  await session.agent.act("pay for the order")
  await settleWebhooks(run)

  const paid = await paidPayments(run)
  const credits = await shopCredits(run)

  if (run.clean) assert.equal(paid, 1, "the clean run pays once")
  assert.ok(paid <= 1, `the customer was charged ${paid} times`)
  assert.equal(
    credits,
    500 * paid,
    `credits match payments: ${credits} credits for ${paid} payment(s)`,
  )
  if (session.divergence() === undefined && paid === 1)
    await session.expect(session.screen.getByText(/^Credits: /)).toHaveText("Credits: 500")
}

const webhookFaults = [
  { kind: "duplicate" },
  { kind: "delay", ms: 10 * 60_000 },
  { kind: "forged" },
  { kind: "stale", seconds: 3600 },
] as const

/** Faulted runs whose fault shows on none of their exchanges or deliveries: it never fired. */
function unfiredFaults(result: FaultMatrixResult): string[] {
  return result.runs.flatMap((run) => {
    const fault = run.fault

    if (fault?.target === "outbound") {
      const label = describeOutboundFault(fault.fault)

      return run.exchanges.some((e) => e.fault === label) ? [] : [fault.label]
    }

    if (fault?.target === "webhook") {
      const label = describeWebhookFault(fault.fault)

      return run.deliveries.some((d) => d.fault === label) ? [] : [fault.label]
    }

    return []
  })
}

let cacheDirs: string[] = []

beforeAll(() => {
  cacheDirs = []
})

afterAll(async () => {
  for (const dir of cacheDirs) await rm(dir, { recursive: true, force: true })
})

async function cacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "danwo-matrix-cache-"))

  cacheDirs.push(dir)

  return dir
}

describe("fault matrix on the browser journey", () => {
  it("passes the shop under every fault, replaying with no model calls", async () => {
    const refusing = refusingModel()
    const result = await runFaultMatrix({
      environment: environment(await cacheDir(), refusing),
      journey: buyCredits,
      outboundFaults: stripeOutboundFaults,
      webhookFaults,
    })
    const report = formatMatrix(result)

    console.log(`[browser matrix: correct shop]\n${report}`)

    expect(result.clean.status, report).toBe("passed")
    const routes = new Set(
      result.runs.flatMap((r) => (r.fault?.target === "outbound" ? [r.fault.route] : [])),
    )

    expect([...routes], report).toEqual(
      expect.arrayContaining([
        "POST api.stripe.com/v1/checkout/sessions",
        "GET checkout.stripe.com/checkout/:id",
        "POST checkout.stripe.com/checkout/:id/complete",
      ]),
    )
    expect(
      result.runs.filter((r) => r.status !== "passed"),
      report,
    ).toEqual([])
    expect(refusing.doGenerateCalls).toHaveLength(0)
    expect(
      result.runs.some((r) => r.notes.some((note) => note.startsWith("diverged at step"))),
      report,
    ).toBe(true)
    expect(unfiredFaults(result)).toEqual([])

    // Which outcome each run reached, not only that credits matched payments.
    const run = (label: string) => result.runs.find((r) => r.fault?.label === label)
    const completed = (r: (typeof result.runs)[number] | undefined) =>
      r?.deliveries.some((d) => d.topic === "checkout.session.completed" && d.delivered) ?? false

    // Stripe captured the payment although the browser's connection dropped: the webhook still lands.
    expect(completed(run("reset-after on POST checkout.stripe.com/checkout/:id/complete"))).toBe(
      true,
    )
    // The shop could not start a checkout: nothing paid, nothing delivered.
    expect(completed(run("status 429 on POST api.stripe.com/v1/checkout/sessions"))).toBe(false)
  }, 600_000)

  it("catches a shop that grants credits twice for a duplicated webhook", async () => {
    const refusing = refusingModel()
    const result = await runFaultMatrix({
      environment: environment(await cacheDir(), refusing, "no-dedupe"),
      journey: buyCredits,
      outboundFaults: stripeOutboundFaults,
      webhookFaults,
    })
    const report = formatMatrix(result)

    console.log(`[browser matrix: no-dedupe shop]\n${report}`)

    const failed = result.runs.filter((r) => r.status !== "passed")

    expect(
      failed.map((r) => r.fault?.label),
      report,
    ).toEqual(["duplicate on webhook checkout.session.completed"])
    expect(failed[0]?.error).toContain("credits match payments: 1000 credits for 1 payment(s)")
    expect(refusing.doGenerateCalls).toHaveLength(0)
    expect(unfiredFaults(result)).toEqual([])
  }, 600_000)
})
