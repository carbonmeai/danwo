import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { bachsLedger } from "../src/bachs/index.ts"
import { type BachsHarness, startBachs } from "./bachs-client.ts"

const DAY = 24 * 60 * 60 * 1000

let bachs: BachsHarness

afterEach(async () => {
  await bachs.close()
})

/** A monthly plan, optionally with a free trial. */
async function plan(name: string, amount: string, trialDays?: number): Promise<string> {
  const created = await bachs.call("POST", "/v1/products", {
    name,
    price: { currency: "USD", amount },
    billing_cycle: { interval: "month", frequency: 1 },
    ...(trialDays && { trial_period: { interval: "day", frequency: trialDays } }),
  })

  return String((await created.json())["id"])
}

/** Subscribes Jane to `product` through a hosted checkout and returns the subscription id. */
async function subscribe(product: string, card?: string): Promise<string> {
  const checkout = await bachs.client.checkoutSessions.create({
    product_cart: [{ product_id: product, quantity: 1 }],
    customer: { email: "jane@danwo-shop.com", name: "Jane Doe" },
    metadata: { plan: "pro" },
  })

  await bachs.pay(checkout.checkout_url, card ? { card } : {})
  await bachs.pass(1000)

  return String((await bachs.client.checkoutSessions.get(checkout.checkout_id))["subscription_id"])
}

describe("Bachs subscriptions", () => {
  beforeEach(async () => {
    bachs = await startBachs()
  })

  it("starts a subscription from a recurring checkout and renews it each month", async () => {
    const id = await subscribe(await plan("Pro", "10.00"))
    const started = await bachs.client.subscriptions.get(id)

    expect(started).toMatchObject({
      status: "active",
      amount: "10.00",
      currency: "USD",
      billing_cycle: { interval: "month", frequency: 1 },
      metadata: { plan: "pro" },
    })
    expect(bachs.types()).toEqual(
      expect.arrayContaining([
        "collection.succeeded",
        "invoice.created",
        "invoice.paid",
        "customer.subscription.created",
        "checkout.completed",
      ]),
    )

    await bachs.pass(32 * DAY)

    const renewed = await bachs.client.subscriptions.get(id)

    expect(Date.parse(renewed.current_period_start ?? "")).toBe(
      Date.parse(started.current_period_end ?? ""),
    )
    expect(bachs.types().filter((type) => type === "invoice.paid")).toHaveLength(2)
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("20.00")
  })

  it("saves the card without charging during a trial, then bills when the trial ends", async () => {
    const id = await subscribe(await plan("Pro", "10.00", 14))

    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ status: "trialing" })
    expect(bachs.types()).not.toContain("collection.succeeded")
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("0.00")

    await bachs.pass(14 * DAY)

    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ status: "active" })
    expect(bachs.types()).toEqual(
      expect.arrayContaining(["invoice.paid", "customer.subscription.updated"]),
    )
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("10.00")
  })

  it("ends a trial early with a past trial_end and bills at once", async () => {
    const id = await subscribe(await plan("Pro", "10.00", 14))
    const ended = await bachs.call("PATCH", `/v1/subscriptions/${id}`, {
      trial_end: new Date(bachs.clock.clock().getTime() - 1000).toISOString(),
    })

    expect(await ended.json()).toMatchObject({ status: "active" })
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("10.00")

    const again = await bachs.call("PATCH", `/v1/subscriptions/${id}`, {
      trial_end: new Date(0).toISOString(),
    })

    expect(await again.json()).toMatchObject({ error_code: "SUBSCRIPTION_NOT_TRIALING" })
  })

  it("retries a failed renewal, emails a recovery link, and reactivates when the card is updated", async () => {
    const id = await subscribe(await plan("Pro", "10.00"))
    const ledger = bachsLedger(bachs.emulator)

    ledger.failCard(id)
    await bachs.pass(31 * DAY)

    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ status: "past_due" })
    expect(bachs.types()).toContain("invoice.payment_failed")

    const [email] = ledger.recoveryEmails("jane@danwo-shop.com")

    expect(email?.link).toMatch(/^https:\/\/checkout\.bachs\.io\/recover\//)

    const page = await bachs.emulator.fetch(
      new Request(email?.link ?? "", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "card=4242424242424242",
      }),
    )

    expect(await page.text()).toContain("Card updated")
    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ status: "active" })
  })

  it("cancels the subscription when recovery runs out", async () => {
    const id = await subscribe(await plan("Pro", "10.00"))

    bachsLedger(bachs.emulator).failCard(id)
    await bachs.pass(31 * DAY)
    for (const days of [1, 3, 5]) await bachs.pass(days * DAY)

    expect(await bachs.client.subscriptions.get(id)).toMatchObject({
      status: "canceled",
      cancellation_reason: "payment_failed",
    })
    expect(bachs.types().filter((type) => type === "invoice.payment_failed")).toHaveLength(4)
    expect(bachs.types()).toContain("customer.subscription.deleted")
  })

  it("prorates an upgrade now and turns a downgrade into credit used on the next invoice", async () => {
    const pro = await plan("Pro", "10.00")
    const team = await plan("Team", "30.00")
    const id = await subscribe(pro)

    await bachs.pass(15 * DAY)

    const upgraded = await (
      await bachs.call("PATCH", `/v1/subscriptions/${id}`, {
        product_id: team,
        proration_behavior: "invoice_now",
      })
    ).json()

    expect(upgraded).toMatchObject({ amount: "30.00", product_id: team })

    const afterUpgrade = Number(bachsLedger(bachs.emulator).balance("USD"))

    expect(afterUpgrade).toBeGreaterThan(10)
    expect(afterUpgrade).toBeLessThan(30)

    await bachs.call("PATCH", `/v1/subscriptions/${id}`, {
      product_id: pro,
      proration_behavior: "none",
    })
    await bachs.pass(17 * DAY)

    expect(Number(bachsLedger(bachs.emulator).balance("USD")) - afterUpgrade).toBeLessThan(10)

    const reset = await bachs.call("PATCH", `/v1/subscriptions/${id}`, {
      product_id: team,
      proration_behavior: "reset",
    })

    expect(await reset.json()).toMatchObject({ error_code: "PRORATION_BEHAVIOR_NOT_SUPPORTED" })
  })

  it("cancels at the period's end or at once, and refuses a second cancellation", async () => {
    const id = await subscribe(await plan("Pro", "10.00"))
    const scheduled = await bachs.client.subscriptions.cancel(id, {
      cancel_at_period_end: true,
      reason: "Customer requested",
    })

    expect(scheduled).toMatchObject({ status: "active", cancel_at_period_end: true })

    await bachs.pass(32 * DAY)
    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ status: "canceled" })
    expect((await bachs.call("DELETE", `/v1/subscriptions/${id}`, {})).status).toBe(400)
  })

  it("lets the customer cancel in the portal", async () => {
    const id = await subscribe(await plan("Pro", "10.00"))
    const subscription = await bachs.client.subscriptions.get(id)
    const session = await bachs.client.customerPortal.createSession(
      subscription.customer?.customer_id ?? "",
    )
    const token = new URL(session.url).pathname.split("/").at(-1) ?? ""

    await bachs.emulator.fetch(
      new Request(`https://portal.bachs.io/s/${token}/cancel/${id}`, { method: "POST" }),
    )
    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ cancel_at_period_end: true })
  })
})

describe("Bachs subscriptions marked unpaid", () => {
  beforeEach(async () => {
    bachs = await startBachs({ recovery: "mark_unpaid" })
  })

  it("keeps the subscription unpaid instead of canceling it", async () => {
    const id = await subscribe(await plan("Pro", "10.00"))

    bachsLedger(bachs.emulator).failCard(id)
    await bachs.pass(31 * DAY)
    for (const days of [1, 3, 5]) await bachs.pass(days * DAY)

    expect(await bachs.client.subscriptions.get(id)).toMatchObject({ status: "unpaid" })
    expect(bachsLedger(bachs.emulator).updateCard(id)).toMatchObject({ status: "active" })
  })
})
