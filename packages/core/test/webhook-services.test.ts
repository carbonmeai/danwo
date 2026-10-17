import { once } from "node:events"
import { createServer, type Server } from "node:http"

import {
  createEmulator,
  type Emulator,
  listeningPort,
  ManualClock,
  resend,
  seedResend,
  seedStripe,
  stripe,
  type WebhookDispatcher,
} from "@danwo/emulators"
import { type Proxy, startProxy } from "@danwo/proxy"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { formatMatrix, type RunEnvironment, runFaultMatrix } from "../src/fault-matrix.ts"

interface TwoServices extends RunEnvironment {
  readonly proxy: Proxy
  readonly webhooks: { readonly stripe: WebhookDispatcher; readonly resend: WebhookDispatcher }
  readonly stripe: Emulator
  readonly resend: Emulator
  readonly clock: ManualClock
}

let receiver: Server
let receiverUrl: string

beforeAll(async () => {
  receiver = createServer((_req, res) => res.writeHead(200).end())
  receiver.listen(0, "127.0.0.1")
  await once(receiver, "listening")
  receiverUrl = `http://127.0.0.1:${listeningPort(receiver)}`
})

afterAll(() => {
  receiver.close()
})

/** A Stripe and a Resend emulator, each delivering its webhooks to the receiver. */
async function twoServices(): Promise<TwoServices> {
  const clock = new ManualClock(new Date())
  const timing = { clock: clock.clock, timer: clock.timer }
  const stripeEmulator = createEmulator(stripe, timing)
  const resendEmulator = createEmulator(resend, timing)
  const proxy = await startProxy({ routes: [] })

  seedStripe(stripeEmulator.store, {
    webhookEndpoints: [
      { url: `${receiverUrl}/stripe`, events: ["customer.created"], secret: "whsec_two" },
    ],
  })
  seedResend(resendEmulator.store, {
    webhooks: [{ endpoint: `${receiverUrl}/resend`, events: ["email.sent"] }],
  })

  return {
    proxy,
    webhooks: { stripe: stripeEmulator.webhooks!, resend: resendEmulator.webhooks! },
    stripe: stripeEmulator,
    resend: resendEmulator,
    clock,
    async close() {
      await proxy.stop()
      await stripeEmulator.close()
      await resendEmulator.close()
    },
  }
}

/** Signs up: a Stripe customer and a welcome email, each answered by a webhook. */
async function signUp(env: TwoServices): Promise<void> {
  await env.stripe.fetch(
    new Request("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        authorization: "Bearer sk_test_two",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "email=qa%40danwo.test",
    }),
  )
  await env.resend.fetch(
    new Request("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer re_test_two", "content-type": "application/json" },
      body: JSON.stringify({
        from: "qa@danwo.test",
        to: "user@danwo.test",
        subject: "Hi",
        html: "<p>Hi</p>",
      }),
    }),
  )
  await settle(env)
}

/** Plays both services' pending deliveries to the end on the shared manual clock. */
async function settle(env: TwoServices): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await env.webhooks.stripe.idle()
    await env.webhooks.resend.idle()

    const next = env.clock.nextIn()

    if (next === undefined) return
    env.clock.advance(next)
  }

  throw new Error("webhook deliveries did not settle")
}

describe("fault matrix with two webhook services", () => {
  it("plans and applies webhook faults on every service, labelled by service", async () => {
    const result = await runFaultMatrix({
      environment: twoServices,
      journey: signUp,
      outboundFaults: () => [],
      webhookFaults: [{ kind: "duplicate" }],
    })
    const report = formatMatrix(result)

    expect(result.clean.status, report).toBe("passed")
    expect(result.runs.map((r) => r.fault?.label)).toEqual([
      "duplicate on stripe webhook customer.created",
      "duplicate on resend webhook email.sent",
    ])
    expect(result.runs.map((r) => r.status)).toEqual(["passed", "passed"])

    // Each fault lands on its own service's delivery and no other.
    const faulted = result.runs.map((r) =>
      r.deliveries.filter((d) => d.fault !== null).map((d) => `${d.service} ${d.topic}`),
    )

    expect(faulted.map((services) => [...new Set(services)])).toEqual([
      ["stripe customer.created"],
      ["resend email.sent"],
    ])
  }, 30_000)
})
