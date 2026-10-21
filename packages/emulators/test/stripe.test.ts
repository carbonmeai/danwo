import { once } from "node:events"
import type { Server } from "node:http"

import { Stripe } from "stripe"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { STRIPE_API_VERSION } from "../src/stripe/events.ts"
import { stripe, stripeSignature } from "../src/stripe/index.ts"
import { fakeKey } from "./fake-key.ts"

const fixedNow = new Date("2026-10-16T12:00:00Z")

let emulator: Emulator
let server: Server
let baseUrl: string

function client(key = "sk_test_emulated"): Stripe {
  const port = listeningPort(server)

  return new Stripe(key, { host: "127.0.0.1", port, protocol: "http", maxNetworkRetries: 0 })
}

/** An event the emulator queued, read back from its outbox. */
const QueuedEvent = z.looseObject({
  id: z.string(),
  type: z.string(),
  data: z.looseObject({ object: z.looseObject({}) }),
})

function outboxEvents(): z.infer<typeof QueuedEvent>[] {
  return emulator.outbox.all().map((m) => QueuedEvent.parse(m.body))
}

/** An expandable field's object; fails the test when only an id came back. */
function expandedObject<T extends object>(value: string | T | null | undefined): T {
  if (typeof value !== "object" || value === null) throw new Error("expected an expanded object")

  return value
}

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(stripe, { clock: () => fixedNow, baseUrl })
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  emulator.reset()
})

describe("API keys", () => {
  it("rejects a request without a key", async () => {
    const res = await fetch(`${baseUrl}/v1/customers`)

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { type: "invalid_request_error" } })
  })

  it("rejects a live key", async () => {
    await expect(client(fakeKey("sk_", "live_abcdefgh")).customers.list()).rejects.toMatchObject({
      type: "StripeAuthenticationError",
      message: "Invalid API Key provided: sk_live_****efgh",
    })
  })

  it("does not require a key for the hosted checkout page", async () => {
    const res = await fetch(`${baseUrl}/checkout/cs_missing`)

    expect(res.status).toBe(404)
  })
})

describe("customers", () => {
  it("creates and retrieves a customer through the official client", async () => {
    const s = client()
    const created = await s.customers.create({ email: "a@b.co", metadata: { plan: "pro" } })

    expect(created.id).toMatch(/^cus_/)
    expect(created.created).toBe(fixedNow.getTime() / 1000)

    const fetched = await s.customers.retrieve(created.id)

    expect(fetched).toMatchObject({ id: created.id, email: "a@b.co", metadata: { plan: "pro" } })
  })

  it("returns Stripe's error for a missing customer", async () => {
    await expect(client().customers.retrieve("cus_missing")).rejects.toMatchObject({
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      statusCode: 404,
    })
  })

  it("lists with cursor pagination", async () => {
    const s = client()

    for (let i = 0; i < 3; i++) await s.customers.create({ email: `p${i}@b.co` })
    const first = await s.customers.list({ limit: 2 })

    expect(first.data).toHaveLength(2)
    expect(first.has_more).toBe(true)
    const last = first.data.at(-1)
    const second = await s.customers.list({ limit: 2, starting_after: last?.id ?? "" })

    // Three created plus the seeded customer.
    expect(second.data).toHaveLength(2)
    expect(second.has_more).toBe(false)
  })
})

describe("form-encoded bodies", () => {
  it("reads active=false as false", async () => {
    const product = await client().products.create({ name: "Credits", active: false })

    expect(product.active).toBe(false)
  })
})

describe("payment intents", () => {
  it("confirms, creates a charge and emits events with Stripe's envelope", async () => {
    const s = client()
    const pi = await s.paymentIntents.create({ amount: 1000, currency: "usd" })
    const confirmed = await s.paymentIntents.confirm(pi.id, { payment_method: "pm_card_visa" })

    expect(confirmed.status).toBe("succeeded")

    expect(pi.client_secret).toMatch(new RegExp(`^${pi.id}_secret_`))
    expect(pi.amount_received).toBe(0)

    const charges = await s.charges.list({ payment_intent: pi.id })

    expect(charges.data).toHaveLength(1)
    const [charge] = charges.data

    expect(confirmed).toMatchObject({ amount_received: 1000, latest_charge: charge?.id })
    expect(charge).toMatchObject({
      paid: true,
      captured: true,
      amount_captured: 1000,
      outcome: { type: "authorized" },
    })
    // A test token becomes a real payment method, as in Stripe.
    expect(charge?.payment_method).toMatch(/^pm_/)
    const pm = await s.paymentMethods.retrieve(charge?.payment_method ?? "")

    expect(pm.card).toMatchObject({ brand: "visa", last4: "4242" })

    const types = outboxEvents().map((e) => e.type)

    expect(types).toEqual([
      "payment_intent.created",
      "payment_intent.succeeded",
      "charge.succeeded",
    ])

    const succeeded = outboxEvents()[1]

    expect(succeeded).toMatchObject({
      object: "event",
      api_version: STRIPE_API_VERSION,
      created: fixedNow.getTime() / 1000,
      livemode: false,
      data: { object: { id: pi.id, status: "succeeded" } },
    })
    expect(succeeded?.id).toMatch(/^evt_/)

    const chargeEvent = outboxEvents()[2]?.data.object

    expect(chargeEvent).toMatchObject({ object: "charge", payment_intent: pi.id, amount: 1000 })
  })

  it("records when and why an intent was canceled", async () => {
    const s = client()
    const pi = await s.paymentIntents.create({ amount: 500, currency: "usd" })
    const canceled = await s.paymentIntents.cancel(pi.id, { cancellation_reason: "abandoned" })

    expect(canceled).toMatchObject({
      status: "canceled",
      canceled_at: fixedNow.getTime() / 1000,
      cancellation_reason: "abandoned",
    })
  })

  it("serves emitted events from /v1/events", async () => {
    const s = client()

    await s.customers.create({ email: "e@b.co" })
    const emitted = outboxEvents()[0]
    const fetched = await s.events.retrieve(emitted?.id ?? "")

    expect(fetched).toEqual(emitted)
  })
})

describe("checkout", () => {
  it("completes through the hosted page and emits checkout.session.completed", async () => {
    const s = client()
    const product = await s.products.create({ name: "1,000 credits" })
    const price = await s.prices.create({ product: product.id, currency: "usd", unit_amount: 1000 })
    const session = await s.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: price.id, quantity: 2 }],
      client_reference_id: "ws_123",
      success_url: "https://app.test/done?session={CHECKOUT_SESSION_ID}",
    })

    expect(session.url).toContain(`/checkout/${session.id}`)
    expect(session).toMatchObject({
      amount_subtotal: 2000,
      amount_total: 2000,
      currency: "usd",
      client_reference_id: "ws_123",
      expires_at: fixedNow.getTime() / 1000 + 24 * 60 * 60,
      ui_mode: "hosted",
    })

    const page = await fetch(`${baseUrl}/checkout/${session.id}`)

    expect(await page.text()).toContain('data-testid="checkout-pay"')

    const done = await fetch(`${baseUrl}/checkout/${session.id}/complete`, {
      method: "POST",
      redirect: "manual",
    })

    expect(done.headers.get("location")).toBe(`https://app.test/done?session=${session.id}`)

    const completed = await s.checkout.sessions.retrieve(session.id)

    expect(completed).toMatchObject({ status: "complete", payment_status: "paid" })
    expect(outboxEvents().at(-1)?.type).toBe("checkout.session.completed")
  })
})

describe("webhook signatures", () => {
  it("produces a signature the official client verifies", () => {
    const body = JSON.stringify({ id: "evt_1", object: "event" })
    const timestamp = Math.floor(Date.now() / 1000)
    const header = stripeSignature("whsec_test", body, timestamp)
    const event = Stripe.webhooks.constructEvent(body, header, "whsec_test")

    expect(event.id).toBe("evt_1")
  })
})

describe("state", () => {
  it("restores a snapshot and resets to the seed", async () => {
    const s = client()
    const snapshot = emulator.snapshot()

    await s.customers.create({ email: "temp@b.co" })
    expect((await s.customers.list()).data).toHaveLength(2)

    emulator.restore(snapshot)
    expect((await s.customers.list()).data).toHaveLength(1)

    await s.customers.create({ email: "temp@b.co" })
    emulator.reset()
    const after = await s.customers.list()

    expect(after.data.map((c) => c.email)).toEqual(["test@example.com"])
    expect(emulator.outbox.all()).toHaveLength(0)
  })
})

describe("expand", () => {
  it("expands ids on retrieve, through nested paths", async () => {
    const s = client()
    const customer = await s.customers.create({ email: "x@b.co" })
    const pi = await s.paymentIntents.create({
      amount: 700,
      currency: "usd",
      customer: customer.id,
      payment_method: "pm_card_visa",
    })

    await s.paymentIntents.confirm(pi.id)
    const charge = (await s.charges.list({ payment_intent: pi.id })).data[0]

    const expanded = await s.charges.retrieve(charge?.id ?? "", {
      expand: ["customer", "payment_intent.payment_method"],
    })

    expect(expanded.customer).toMatchObject({ id: customer.id, object: "customer" })
    expect(expanded.payment_intent).toMatchObject({
      id: pi.id,
      payment_method: { object: "payment_method", card: { last4: "4242" } },
    })
  })

  it("expands inside lists with data.", async () => {
    const s = client()
    const customer = await s.customers.create({ email: "l@b.co" })

    await s.paymentIntents.create({ amount: 100, currency: "usd", customer: customer.id })
    const list = await s.paymentIntents.list({ expand: ["data.customer"] })

    expect(list.data[0]?.customer).toMatchObject({ id: customer.id })
  })

  it("rejects a path that cannot be expanded", async () => {
    const s = client()
    const customer = await s.customers.create({ email: "n@b.co" })

    await expect(s.customers.retrieve(customer.id, { expand: ["nope"] })).rejects.toMatchObject({
      type: "StripeInvalidRequestError",
      message: "This property cannot be expanded (nope).",
    })
  })
})

describe("idempotency keys", () => {
  it("replays the first result for a retried request", async () => {
    const s = client()
    const first = await s.customers.create({ email: "i@b.co" }, { idempotencyKey: "k1" })
    const retry = await s.customers.create({ email: "i@b.co" }, { idempotencyKey: "k1" })

    expect(retry.id).toBe(first.id)
    expect(retry.lastResponse.headers["idempotent-replayed"]).toBe("true")
    expect((await s.customers.list({ email: "i@b.co" })).data).toHaveLength(1)
  })

  it("rejects the same key with different parameters", async () => {
    const s = client()

    await s.customers.create({ email: "a1@b.co" }, { idempotencyKey: "k2" })
    await expect(
      s.customers.create({ email: "a2@b.co" }, { idempotencyKey: "k2" }),
    ).rejects.toMatchObject({ type: "StripeIdempotencyError" })
  })

  it("forgets keys after 24 hours", async () => {
    let now = new Date("2026-10-16T12:00:00Z")
    const local = createEmulator(stripe, { clock: () => now })
    const post = (email: string) =>
      local.fetch(
        new Request("http://stripe.localhost/v1/customers", {
          method: "POST",
          headers: {
            Authorization: "Bearer sk_test_x",
            "Idempotency-Key": "k3",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `email=${email}`,
        }),
      )

    expect((await post("one@b.co")).status).toBe(200)
    expect((await post("two@b.co")).status).toBe(400)
    now = new Date("2026-10-17T12:00:01Z")
    expect((await post("two@b.co")).status).toBe(200)
  })
})

describe("payment method configurations", () => {
  it("starts with the account default and creates others", async () => {
    const s = client()
    const before = await s.paymentMethodConfigurations.list()

    expect(before.data).toHaveLength(1)
    expect(before.data[0]).toMatchObject({ is_default: true, active: true })

    const cards = await s.paymentMethodConfigurations.create({
      name: "Cards only",
      link: { display_preference: { preference: "off" } },
    })

    expect(cards).toMatchObject({
      name: "Cards only",
      is_default: false,
      card: { display_preference: { preference: "on" } },
      link: { display_preference: { preference: "off" } },
    })
  })

  it("rejects an unknown configuration on checkout", async () => {
    const s = client()
    const product = await s.products.create({ name: "P" })

    await expect(
      s.checkout.sessions.create({
        mode: "payment",
        line_items: [
          { price_data: { currency: "usd", product: product.id, unit_amount: 100 }, quantity: 1 },
        ],
        payment_method_configuration: "pmc_missing",
      }),
    ).rejects.toMatchObject({ code: "resource_missing", param: "payment_method_configuration" })
  })
})

describe("one-off payment through Checkout", () => {
  it("creates the PaymentIntent, saved card and paid invoice when the customer pays", async () => {
    const s = client()
    const customer = await s.customers.create({ email: "buyer@b.co" })
    const product = await s.products.create({ name: "1,000 credits" })
    const cards = await s.paymentMethodConfigurations.create({ name: "Cards only" })
    const metadata = { kind: "topup", credits: "1000" }

    const session = await s.checkout.sessions.create({
      mode: "payment",
      customer: customer.id,
      client_reference_id: "ws_1",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product: product.id,
            unit_amount: 1500,
            tax_behavior: "exclusive",
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        setup_future_usage: "off_session",
        description: "1,000 credits",
        metadata,
      },
      invoice_creation: { enabled: true, invoice_data: { description: "1,000 credits", metadata } },
      metadata,
      payment_method_configuration: cards.id,
      success_url: "https://app.test/done",
      cancel_url: "https://app.test/cancel",
    })

    expect(session).toMatchObject({
      amount_total: 1500,
      currency: "usd",
      payment_intent: null,
      invoice: null,
      payment_method_configuration_details: { id: cards.id },
      invoice_creation: { enabled: true },
    })

    await fetch(`${baseUrl}/checkout/${session.id}/complete`, {
      method: "POST",
      redirect: "manual",
    })

    const paid = await s.checkout.sessions.retrieve(session.id, {
      expand: ["payment_intent", "invoice"],
    })

    expect(paid).toMatchObject({
      status: "complete",
      payment_status: "paid",
      amount_subtotal: 1500,
    })

    const intent = expandedObject(paid.payment_intent)

    expect(intent).toMatchObject({
      status: "succeeded",
      amount_received: 1500,
      customer: customer.id,
      description: "1,000 credits",
      metadata,
      setup_future_usage: "off_session",
    })

    const invoice = expandedObject(paid.invoice)

    expect(invoice).toMatchObject({
      status: "paid",
      amount_paid: 1500,
      customer: customer.id,
      metadata,
    })
    const receipt = await fetch(invoice.hosted_invoice_url ?? "")

    expect(receipt.status).toBe(200)

    const saved = await s.customers.listPaymentMethods(customer.id, { type: "card" })

    expect(saved.data.map((pm) => pm.id)).toEqual([intent.payment_method])

    const types = outboxEvents().map((e) => e.type)

    expect(types.slice(types.indexOf("payment_intent.created"))).toEqual([
      "payment_intent.created",
      "payment_method.attached",
      "payment_intent.succeeded",
      "charge.succeeded",
      "invoice.created",
      "invoice.finalized",
      "invoice.paid",
      "invoice.payment_succeeded",
      "checkout.session.completed",
    ])
  })
})

describe("refunds and deleted customers", () => {
  it("refunds a payment intent's charge in full, then refuses a second refund", async () => {
    const s = client()
    const pi = await s.paymentIntents.create({ amount: 2000, currency: "usd" })

    await s.paymentIntents.confirm(pi.id, { payment_method: "pm_card_visa" })

    const refund = await s.refunds.create({ payment_intent: pi.id })

    expect(refund).toMatchObject({
      object: "refund",
      amount: 2000,
      status: "succeeded",
      payment_intent: pi.id,
    })
    await expect(s.refunds.retrieve(refund.id)).resolves.toMatchObject({ id: refund.id })
    const charge = typeof refund.charge === "string" ? refund.charge : (refund.charge?.id ?? "")

    await expect(s.charges.retrieve(charge)).resolves.toMatchObject({
      refunded: true,
      amount_refunded: 2000,
    })
    await expect(s.refunds.create({ payment_intent: pi.id })).rejects.toMatchObject({
      code: "charge_already_refunded",
    })
    expect(outboxEvents().map((e) => e.type)).toEqual(
      expect.arrayContaining(["refund.created", "charge.refunded"]),
    )
  })

  it("reads a deleted customer back as deleted", async () => {
    const s = client()
    const customer = await s.customers.create({ email: "gone@example.com" })

    await s.customers.del(customer.id)

    await expect(s.customers.retrieve(customer.id)).resolves.toMatchObject({
      id: customer.id,
      deleted: true,
    })
  })

  it("attaches a new payment method for a test token, as Stripe does", async () => {
    const s = client()
    const customer = await s.customers.create({ email: "token@example.com" })
    const attached = await s.paymentMethods.attach("pm_card_chargeCustomerFail", {
      customer: customer.id,
    })

    expect(attached.id).toMatch(/^pm_/)
    expect(attached.id).not.toBe("pm_card_chargeCustomerFail")
    expect(attached).toMatchObject({ customer: customer.id, card: { last4: "0341" } })

    const saved = await s.customers.listPaymentMethods(customer.id, { type: "card" })

    expect(saved.data.map((pm) => pm.id)).toEqual([attached.id])
  })
})
