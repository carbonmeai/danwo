import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { bachsLedger } from "../src/bachs/index.ts"
import { type BachsHarness, startBachs } from "./bachs-client.ts"

let bachs: BachsHarness
let ebook: string

beforeEach(async () => {
  bachs = await startBachs()
  ebook = (
    await bachs.client.products.create({
      name: "Ebook",
      price: { currency: "USD", amount: "29.00" },
    })
  ).id
})

afterEach(async () => {
  await bachs.close()
})

/** Creates a checkout for one ebook. */
function buyEbook(extra: Record<string, unknown> = {}) {
  return bachs.client.checkoutSessions.create({
    product_cart: [{ product_id: ebook, quantity: 1 }],
    customer: { email: "jane@danwo-shop.com", name: "Jane Doe" },
    success_url: "https://shop.example.com/thanks",
    cancel_url: "https://shop.example.com/cart",
    reference: "order_1042",
    ...extra,
  })
}

describe("Bachs checkout", () => {
  it("serves a hosted page, takes a test card, settles a second later and confirms with signed webhooks", async () => {
    const created = await buyEbook()

    expect(created.checkout_url).toMatch(/^https:\/\/checkout\.bachs\.io\/c\//)
    expect(created).toMatchObject({ status: "open", reference: "order_1042" })

    const page = await (await bachs.emulator.fetch(new Request(created.checkout_url))).text()

    expect(page).toContain("Pay $29.00")

    const paid = await bachs.pay(created.checkout_url)

    expect(paid.status).toBe(200)
    expect(await paid.text()).toContain(
      `https://shop.example.com/thanks?checkout_id=${created.checkout_id}`,
    )
    expect((await bachs.client.checkoutSessions.get(created.checkout_id)).charge?.status).toBe(
      "processing",
    )

    await bachs.pass(1000)

    const checkout = await bachs.client.checkoutSessions.get(created.checkout_id)

    expect(checkout).toMatchObject({
      status: "completed",
      payment_status: "paid",
      amount: "29.00",
      currency: "USD",
    })
    expect(checkout.charge).toMatchObject({
      status: "succeeded",
      amount: "29.00",
      reference: "order_1042",
      is_refundable: true,
    })
    expect(bachs.types()).toEqual([
      "customer.created",
      "collection.succeeded",
      "checkout.completed",
    ])

    const collected = bachs.delivered.find((item) => item.event.type === "collection.succeeded")

    expect(collected?.event.data).toMatchObject({
      checkout_id: created.checkout_id,
      reference: "order_1042",
      status: "SUCCEEDED",
      amount: "29.00",
      customer: { email: "jane@danwo-shop.com" },
      product_cart: [{ product_id: ebook, quantity: 1 }],
    })
    expect(collected?.headers["x-bachs-signature-v2"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("29.00")
  })

  it("keeps the checkout open after a declined card and sends collection.failed", async () => {
    const created = await buyEbook()
    const declined = await bachs.pay(created.checkout_url, { card: "4000 0000 0000 0002" })

    expect(declined.status).toBe(402)
    expect(await declined.text()).toContain("Your card was declined.")
    expect(bachs.types()).toContain("collection.failed")
    expect((await bachs.client.checkoutSessions.get(created.checkout_id)).status).toBe("open")

    await bachs.pay(created.checkout_url)
    await bachs.pass(1000)
    expect((await bachs.client.checkoutSessions.get(created.checkout_id)).status).toBe("completed")
  })

  it("lets a guest identify on the page, and keeps them out of the directory unless asked", async () => {
    const guest = await bachs.client.checkoutSessions.create({
      product_cart: [{ product_id: ebook }],
      success_url: "https://shop.example.com/thanks",
    })
    const missing = await bachs.pay(guest.checkout_url)

    expect(await missing.text()).toContain("Enter your email address.")

    await bachs.pay(guest.checkout_url, { email: "guest@danwo-shop.com", name: "Guest" })
    await bachs.pass(1000)

    const checkout = await bachs.client.checkoutSessions.get(guest.checkout_id)

    expect(checkout.customer).toBeNull()
    expect(checkout.customer_details).toEqual({ email: "guest@danwo-shop.com", name: "Guest" })
    expect(bachs.types()).not.toContain("customer.created")
  })

  it("charges a raw amount, or the buyer's choice within a custom price's bounds", async () => {
    const raw = await bachs.client.checkoutSessions.create({
      pricing: { currency: "NGN", amount: "75000.00" },
      customer: { email: "a@danwo-shop.com", name: "A" },
    })

    await bachs.pay(raw.checkout_url)
    await bachs.pass(1000)
    expect((await bachs.client.checkoutSessions.get(raw.checkout_id)).charge).toMatchObject({
      amount: "75000.00",
      currency: "NGN",
    })

    const tip = await bachs.client.checkoutSessions.create({
      product_cart: [
        {
          product_id: ebook,
          pricing: { price_type: "custom", preset_amount: "10.00", minimum_amount: "5.00" },
        },
      ],
      customer: { email: "b@danwo-shop.com", name: "B" },
    })
    const tooLow = await bachs.pay(tip.checkout_url, { amount: "2.00" })

    expect(await tooLow.text()).toContain("Enter at least 5.00.")

    await bachs.pay(tip.checkout_url, { amount: "12.50" })
    await bachs.pass(1000)
    expect((await bachs.client.checkoutSessions.get(tip.checkout_id)).amount).toBe("12.50")
  })

  it("refuses a second checkout with the same reference, a mixed-currency cart and a guest subscription", async () => {
    await buyEbook()

    const naira = (
      await bachs.client.products.create({
        name: "Naira",
        price: { currency: "NGN", amount: "500.00" },
      })
    ).id
    const plan = (
      await bachs.client.products.create({
        name: "Plan",
        price: { currency: "USD", amount: "10.00" },
        billing_cycle: { interval: "month", frequency: 1 },
      })
    ).id
    const answers = await Promise.all([
      bachs.call("POST", "/v1/checkout-sessions", {
        product_cart: [{ product_id: ebook }],
        reference: "order_1042",
      }),
      bachs.call("POST", "/v1/checkout-sessions", {
        product_cart: [{ product_id: ebook }, { product_id: naira }],
      }),
      bachs.call("POST", "/v1/checkout-sessions", { product_cart: [{ product_id: plan }] }),
      bachs.call("POST", "/v1/checkout-sessions", {
        product_cart: [{ product_id: ebook }],
        pricing: { currency: "USD", amount: "1.00" },
      }),
    ])
    const codes = await Promise.all(
      answers.map(async (answer) => [answer.status, (await answer.json())["error_code"]]),
    )

    expect(codes).toEqual([
      [409, "CONFLICT"],
      [400, "CART_CURRENCY_MISMATCH"],
      [400, "VALIDATION_ERROR"],
      [400, "VALIDATION_ERROR"],
    ])
  })

  it("expires an unpaid checkout and sends checkout.expired", async () => {
    const created = await buyEbook({ expires_in_minutes: 5 })

    await bachs.pass(5 * 60_000)
    expect((await bachs.client.checkoutSessions.get(created.checkout_id)).status).toBe("expired")
    expect(bachs.types()).toContain("checkout.expired")
    expect(await (await bachs.emulator.fetch(new Request(created.checkout_url))).text()).toContain(
      "Checkout expired",
    )
  })

  it("serves bachs.js for the overlay checkout", async () => {
    const script = await bachs.emulator.fetch(new Request("https://checkout.bachs.io/bachs.js"))

    expect(script.headers.get("content-type")).toContain("javascript")
    expect(await script.text()).toContain("Checkout")
  })
})

/** Buys an ebook and returns the settled payment's id. */
async function paidCharge(): Promise<string> {
  const created = await buyEbook()

  await bachs.pay(created.checkout_url)
  await bachs.pass(1000)

  return (await bachs.client.checkoutSessions.get(created.checkout_id)).charge?.payment_id ?? ""
}

describe("Bachs payments and refunds", () => {
  it("lists and retrieves payments with how they were paid", async () => {
    const charge = await paidCharge()
    const list = await bachs.client.payments.list({ limit: 10 })

    expect(list.items).toHaveLength(1)

    const all = []

    for await (const item of bachs.client.payments.listAll({ limit: 1 })) all.push(item)

    expect(all.map((item) => item.id)).toEqual(list.items.map((item) => item.id))
    expect(list.items[0]).toMatchObject({
      status: "succeeded",
      amount: "29.00",
      customer_email: "jane@danwo-shop.com",
    })

    const payment = await bachs.client.payments.get(charge)

    expect(payment).toMatchObject({
      payment_id: charge,
      status: "succeeded",
      checkout_id: expect.stringMatching(/^chk_/),
    })
  })

  it("refunds a payment asynchronously, once, and reports refund.created then refund.paid", async () => {
    const charge = await paidCharge()
    const created = await (
      await bachs.call("POST", "/v1/refunds", {
        charge_id: charge,
        reference: "refund_1",
        reason: "Asked",
      })
    ).json()

    expect(created).toMatchObject({
      status: "processing",
      requested_amount: "29.00",
      refunded_amount: null,
    })
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("0.00")

    const twice = await bachs.call("POST", "/v1/refunds", {
      charge_id: charge,
      reference: "refund_2",
    })

    expect(twice.status).toBe(409)

    await bachs.pass(2000)

    expect(
      await (await bachs.call("GET", `/v1/refunds/${String(created["refund_id"])}`)).json(),
    ).toMatchObject({ status: "success", refunded_amount: "29.00" })
    expect((await bachs.client.payments.get(charge)).status).toBe("refunded")
    expect(bachs.types().filter((type) => type.startsWith("refund."))).toEqual([
      "refund.created",
      "refund.paid",
    ])
  })

  it("simulates a failed refund, which releases the balance and leaves the payment refundable", async () => {
    const charge = await paidCharge()

    await bachs.call("POST", "/v1/refunds", {
      charge_id: charge,
      reference: "refund_1",
      amount: "10.00",
      simulated_outcome: "failed",
    })
    await bachs.pass(2000)
    expect(bachs.types()).toContain("refund.failed")
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("29.00")
    expect((await bachs.client.payments.get(charge)).is_refundable).toBe(true)
  })
})
