import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import Stripe from "stripe"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { seedStripe, stripe } from "../src/stripe/index.ts"
import { ManualClock } from "../src/time.ts"

const SECRET = "whsec_test_secret"

interface Received {
  event: Stripe.Event
  signature: string
}

/** Stands in for an app's webhook route: verifies each delivery the way the app would. */
class Receiver {
  readonly received: Received[] = []
  /** Status codes to answer with, one per request; 200 once they run out. */
  statuses: number[] = []
  server: Server = createServer((req, res) => void this.handle(req, res))
  url = ""

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1")
    await once(this.server, "listening")
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/webhooks/stripe`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []

    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks).toString("utf8")
    const signature = String(req.headers["stripe-signature"] ?? "")
    const status = this.statuses.shift() ?? 200

    if (status === 200) {
      const event = Stripe.webhooks.constructEvent(body, signature, SECRET)

      this.received.push({ event, signature })
    }

    res.statusCode = status
    res.end()
  }
}

let clock: ManualClock
let receiver: Receiver
let emulator: Emulator

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url
}

function client(): Stripe {
  return new Stripe("sk_test_emulated", {
    httpClient: Stripe.createFetchHttpClient((input, init) =>
      emulator.fetch(
        new Request(urlOf(input).replace(/^https:\/\/api\.stripe\.com/, emulator.baseUrl), init),
      ),
    ),
    maxNetworkRetries: 0,
  })
}

/** Runs deliveries due now and waits for them to finish. */
async function deliver(advanceMs = 0): Promise<void> {
  clock.advance(advanceMs)
  await emulator.webhooks?.idle()
}

beforeEach(async () => {
  clock = new ManualClock(new Date())
  receiver = new Receiver()
  await receiver.start()
  emulator = createEmulator(stripe, { clock: clock.clock, timer: clock.timer })
})

afterEach(async () => {
  await emulator.close()
  receiver.server.close()
})

function addEndpoint(events: string[] = ["*"]): Promise<Stripe.WebhookEndpoint> {
  return client().webhookEndpoints.create({
    url: receiver.url,
    enabled_events: events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
  })
}

describe("webhook endpoints API", () => {
  it("shows the signing secret only on create", async () => {
    const s = client()
    const created = await addEndpoint(["customer.created"])

    expect(created.secret).toMatch(/^whsec_/)
    const fetched = await s.webhookEndpoints.retrieve(created.id)

    expect(fetched.secret).toBeUndefined()
    expect(fetched).toMatchObject({
      url: receiver.url,
      enabled_events: ["customer.created"],
      status: "enabled",
    })
  })
})

describe("delivery", () => {
  beforeEach(() => {
    emulator.reset()
  })

  it("delivers after the API response, signed so the official client verifies it", async () => {
    seedEndpoint(["customer.created"])
    const customer = await client().customers.create({ email: "w@b.co" })

    // Nothing is sent while the request is being served.
    expect(receiver.received).toHaveLength(0)

    await deliver()
    expect(receiver.received).toHaveLength(1)
    const [{ event }] = receiver.received as [Received]

    expect(event).toMatchObject({
      type: "customer.created",
      pending_webhooks: 1,
      data: { object: { id: customer.id } },
    })
  })

  it("only sends subscribed events to enabled endpoints", async () => {
    seedEndpoint(["payment_intent.succeeded"])
    const disabled = await addEndpoint(["*"])

    await client().webhookEndpoints.update(disabled.id, { disabled: true })
    await client().customers.create({ email: "f@b.co" })
    await deliver()
    expect(receiver.received).toHaveLength(0)
  })

  it("retries a failed delivery on the schedule, signing each attempt at its own time", async () => {
    seedEndpoint(["customer.created"])
    receiver.statuses = [500, 503]
    await client().customers.create({ email: "r@b.co" })

    await deliver()
    expect(receiver.received).toHaveLength(0)
    await deliver(5 * 60_000)
    expect(receiver.received).toHaveLength(0)
    await deliver(30 * 60_000)
    expect(receiver.received).toHaveLength(1)

    const attempts = emulator.webhooks?.attempts() ?? []

    expect(attempts.map((a) => [a.attempt, a.status, a.delivered])).toEqual([
      [1, 500, false],
      [2, 503, false],
      [3, 200, true],
    ])
    const times = attempts.map((a) => Date.parse(a.at))

    expect(times[1]! - times[0]!).toBe(5 * 60_000)
    expect(times[2]! - times[1]!).toBe(30 * 60_000)
  })

  it("gives up after the last retry", async () => {
    seedEndpoint(["customer.created"])
    receiver.statuses = [500, 500, 500, 500, 500]
    await client().customers.create({ email: "g@b.co" })
    await deliver()
    for (const ms of [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 24 * 60 * 60_000]) await deliver(ms)
    expect(emulator.webhooks?.attempts()).toHaveLength(4)
    expect(receiver.received).toHaveLength(0)
  })

  it("records an unreachable endpoint as a failed attempt", async () => {
    seedEndpoint(["customer.created"], "http://127.0.0.1:1/unreachable")
    await client().customers.create({ email: "u@b.co" })
    await deliver()
    const [attempt] = emulator.webhooks?.attempts() ?? []

    expect(attempt).toMatchObject({ status: null, delivered: false })
    expect(attempt?.error).toBeTruthy()
  })

  it("drops pending retries on reset", async () => {
    seedEndpoint(["customer.created"])
    receiver.statuses = [500]
    await client().customers.create({ email: "x@b.co" })
    await deliver()
    emulator.reset()
    await deliver(60 * 60_000)
    expect(emulator.webhooks?.attempts()).toHaveLength(0)
    expect(receiver.received).toHaveLength(0)
  })

  it("delivers checkout.session.completed after a hosted checkout", async () => {
    seedEndpoint(["checkout.session.completed"])
    const s = client()
    const product = await s.products.create({ name: "Credits" })
    const session = await s.checkout.sessions.create({
      mode: "payment",
      line_items: [
        { price_data: { currency: "usd", product: product.id, unit_amount: 900 }, quantity: 1 },
      ],
      success_url: "https://app.test/done",
    })

    await emulator.fetch(
      new Request(`${emulator.baseUrl}/checkout/${session.id}/complete`, { method: "POST" }),
    )
    await deliver()

    expect(receiver.received.map((r) => r.event.type)).toEqual(["checkout.session.completed"])
    const completed = receiver.received[0]?.event.data.object as Stripe.Checkout.Session

    expect(completed).toMatchObject({ id: session.id, payment_status: "paid" })
    expect(completed.payment_intent).toMatch(/^pi_/)
  })
})

function seedEndpoint(events: string[], url = receiver.url): void {
  seedStripe(emulator.store, { webhookEndpoints: [{ url, events, secret: SECRET }] })
}
