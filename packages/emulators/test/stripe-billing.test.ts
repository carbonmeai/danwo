import { once } from "node:events"
import type { Server } from "node:http"

import { Stripe } from "stripe"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { idOf } from "../src/stripe/helpers.ts"
import { seedStripe, stripe } from "../src/stripe/index.ts"
import { ManualClock } from "../src/time.ts"

const DAY_MS = 86_400_000

let clock: ManualClock
let emulator: Emulator
let server: Server
let api: Stripe

const QueuedEvent = z.looseObject({ type: z.string() })

/** The event types queued so far, oldest first. */
function eventTypes(): string[] {
  return emulator.outbox.all().map((m) => QueuedEvent.parse(m.body).type)
}

/** An expandable field's object; fails the test when only an id came back. */
function expanded<T extends object>(value: string | T | null | undefined): T {
  if (typeof value !== "object" || value === null) throw new Error("expected an expanded object")

  return value
}

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")

  const port = listeningPort(server)

  clock = new ManualClock(new Date("2026-10-01T12:00:00Z"))
  emulator = createEmulator(stripe, {
    clock: clock.clock,
    timer: clock.timer,
    baseUrl: `http://127.0.0.1:${port}`,
  })
  api = new Stripe("sk_test_emulated", {
    host: "127.0.0.1",
    port,
    protocol: "http",
    maxNetworkRetries: 0,
  })
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  emulator.reset()
  seedStripe(emulator.store, {
    products: [{ name: "Pro" }],
    prices: [
      {
        product_name: "Pro",
        currency: "usd",
        unit_amount: 2000,
        lookup_key: "pro_monthly",
        recurring: { interval: "month" },
      },
    ],
  })
})

/** The seeded monthly price, found by its lookup key as an app's plans table would. */
async function proPrice(): Promise<Stripe.Price> {
  const { data } = await api.prices.list({ lookup_keys: ["pro_monthly"] })

  const price = data[0]

  if (!price) throw new Error("the seeded price is missing")

  return price
}

/** A customer whose default card is `card` (a test token such as `pm_card_visa`). */
async function customerWith(card: string): Promise<Stripe.Customer> {
  const customer = await api.customers.create({ email: "ada@danwo.test" })
  const setup = await api.setupIntents.create({
    customer: customer.id,
    payment_method: card,
    confirm: true,
  })

  return api.customers.update(customer.id, {
    invoice_settings: { default_payment_method: idOf(setup.payment_method) },
  })
}

describe("setup intents", () => {
  it("saves a card to the customer and reports success", async () => {
    const customer = await api.customers.create({ email: "ada@danwo.test" })
    const created = await api.setupIntents.create({ customer: customer.id })

    expect(created.status).toBe("requires_payment_method")

    const confirmed = await api.setupIntents.confirm(created.id, { payment_method: "pm_card_visa" })
    const methods = await api.customers.listPaymentMethods(customer.id)

    expect(confirmed.status).toBe("succeeded")
    expect(methods.data.map((m) => m.id)).toEqual([confirmed.payment_method])
    expect(eventTypes()).toEqual(
      expect.arrayContaining([
        "setup_intent.created",
        "payment_method.attached",
        "setup_intent.succeeded",
      ]),
    )
  })

  it("declines a card that cannot be saved and holds a 3D Secure one", async () => {
    const customer = await api.customers.create({ email: "ada@danwo.test" })
    const declined = await api.setupIntents.create({ customer: customer.id })

    await expect(
      api.setupIntents.confirm(declined.id, { payment_method: "pm_card_chargeDeclined" }),
    ).rejects.toMatchObject({ type: "StripeCardError", code: "card_declined" })

    const held = await api.setupIntents.create({
      customer: customer.id,
      payment_method: "pm_card_authenticationRequired",
      confirm: true,
    })

    expect(held.status).toBe("requires_action")
    expect(held.next_action?.type).toBe("use_stripe_sdk")
  })
})

describe("subscriptions", () => {
  it("starts active, bills the first period and renews when time moves on", async () => {
    const price = await proPrice()
    const customer = await customerWith("pm_card_visa")
    const subscription = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      expand: ["latest_invoice.payments"],
    })
    const first = expanded(subscription.latest_invoice)

    expect(subscription.status).toBe("active")
    expect(first).toMatchObject({
      status: "paid",
      amount_paid: 2000,
      billing_reason: "subscription_create",
      parent: { subscription_details: { subscription: subscription.id } },
    })
    expect(first.payments?.data[0]?.status).toBe("paid")

    clock.advance(32 * DAY_MS)

    const renewed = await api.subscriptions.retrieve(subscription.id)
    const invoices = await api.invoices.list({ subscription: subscription.id })

    expect(renewed.status).toBe("active")
    expect(renewed.items.data[0]?.current_period_start).toBe(
      subscription.items.data[0]?.current_period_end,
    )
    expect(invoices.data.map((i) => i.billing_reason)).toEqual([
      "subscription_cycle",
      "subscription_create",
    ])
    expect(eventTypes()).toEqual(
      expect.arrayContaining([
        "customer.subscription.created",
        "invoice.paid",
        "customer.subscription.updated",
      ]),
    )
  })

  it("trials for free, warns three days ahead, then charges when the trial ends", async () => {
    const price = await proPrice()
    const customer = await customerWith("pm_card_visa")
    const subscription = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 7,
      expand: ["latest_invoice"],
    })

    expect(subscription.status).toBe("trialing")
    expect(expanded(subscription.latest_invoice).amount_due).toBe(0)

    clock.advance(5 * DAY_MS)
    expect(eventTypes()).toContain("customer.subscription.trial_will_end")

    clock.advance(3 * DAY_MS)

    const after = await api.subscriptions.retrieve(subscription.id, { expand: ["latest_invoice"] })

    expect(after.status).toBe("active")
    expect(expanded(after.latest_invoice)).toMatchObject({
      amount_paid: 2000,
      billing_reason: "subscription_cycle",
    })
  })

  it("falls past due when a renewal's charge is declined, and recovers when the invoice is paid", async () => {
    const price = await proPrice()
    const customer = await customerWith("pm_card_chargeCustomerFail")
    const subscription = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 3,
    })

    clock.advance(4 * DAY_MS)

    const due = await api.subscriptions.retrieve(subscription.id)

    expect(due.status).toBe("past_due")
    expect(eventTypes()).toContain("invoice.payment_failed")

    const paid = await api.invoices.pay(idOf(due.latest_invoice), {
      payment_method: "pm_card_visa",
    })

    expect(paid.status).toBe("paid")
    expect((await api.subscriptions.retrieve(subscription.id)).status).toBe("active")
  })

  it("is refused without a payment method, and starts incomplete for the app to confirm", async () => {
    const price = await proPrice()
    const customer = await api.customers.create({ email: "ada@danwo.test" })

    await expect(
      api.subscriptions.create({ customer: customer.id, items: [{ price: price.id }] }),
    ).rejects.toMatchObject({ code: "resource_missing" })

    const pending = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.confirmation_secret"],
    })
    const secret = expanded(pending.latest_invoice).confirmation_secret?.client_secret ?? ""
    const intent = secret.slice(0, secret.indexOf("_secret_"))

    expect(pending.status).toBe("incomplete")

    await api.paymentIntents.confirm(intent, { payment_method: "pm_card_visa" })
    expect((await api.subscriptions.retrieve(pending.id)).status).toBe("active")
  })

  it("cancels at the end of the period, or at once", async () => {
    const price = await proPrice()
    const customer = await customerWith("pm_card_visa")
    const later = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    })
    const now = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    })
    const scheduled = await api.subscriptions.update(later.id, { cancel_at_period_end: true })

    expect(scheduled.cancel_at).toBe(later.items.data[0]?.current_period_end)
    expect((await api.subscriptions.cancel(now.id)).status).toBe("canceled")

    clock.advance(32 * DAY_MS)

    expect((await api.subscriptions.retrieve(later.id)).status).toBe("canceled")
    expect((await api.subscriptions.list({ customer: customer.id })).data).toEqual([])
    expect(
      (await api.subscriptions.list({ customer: customer.id, status: "all" })).data,
    ).toHaveLength(2)
    expect(eventTypes().filter((type) => type === "customer.subscription.deleted")).toHaveLength(2)
  })
})

describe("Checkout in subscription mode", () => {
  it("starts the subscription on payment, with a trial when asked", async () => {
    const price = await proPrice()
    const session = await api.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: "https://app.danwo.test/done",
      customer_email: "ada@danwo.test",
    })
    const paid = await fetch(`${session.url ?? ""}/complete`.replace("/checkout/", "/checkout/"), {
      method: "POST",
      body: new URLSearchParams({ email: "ada@danwo.test" }),
      redirect: "manual",
    })

    expect(paid.status).toBe(303)

    const completed = await api.checkout.sessions.retrieve(session.id, { expand: ["subscription"] })

    expect(completed).toMatchObject({ status: "complete", payment_status: "no_payment_required" })
    expect(expanded(completed.subscription)).toMatchObject({
      status: "trialing",
      customer: completed.customer,
    })
    expect(eventTypes().indexOf("customer.subscription.created")).toBeLessThan(
      eventTypes().indexOf("checkout.session.completed"),
    )
  })
})

describe("billing portal", () => {
  it("lets the customer cancel at the end of the period and sends them back", async () => {
    const price = await proPrice()
    const customer = await customerWith("pm_card_visa")
    const subscription = await api.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    })
    const session = await api.billingPortal.sessions.create({
      customer: customer.id,
      return_url: "https://app.danwo.test/account",
    })
    const page = await (await fetch(session.url)).text()
    const action = /action="([^"]+)"/.exec(page)?.[1] ?? ""
    const back = await fetch(new URL(action, session.url), { method: "POST", redirect: "manual" })

    expect(back.headers.get("location")).toBe("https://app.danwo.test/account")
    expect((await api.subscriptions.retrieve(subscription.id)).cancel_at_period_end).toBe(true)
  })
})
