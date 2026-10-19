import { BachsApiError } from "@bachs/sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { type BachsHarness, startBachs } from "./bachs-client.ts"

let bachs: BachsHarness

beforeEach(async () => {
  bachs = await startBachs()
})

afterEach(async () => {
  await bachs.close()
})

/** The Bachs error code a call failed with, or undefined when it succeeded. */
function codeOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) =>
      error instanceof BachsApiError ? `${error.status} ${error.errorCode ?? ""}` : error,
  )
}

describe("Bachs products", () => {
  it("creates, retrieves and lists products with fixed, custom and recurring prices", async () => {
    const fixed = await bachs.client.products.create({
      name: "Ebook",
      price: { currency: "USD", amount: "29.00" },
    })
    const custom = await bachs.client.products.create({
      name: "Tip jar",
      price: {
        currency: "NGN",
        price_type: "custom",
        preset_amount: "5000.00",
        minimum_amount: "1000.00",
      },
    })
    const plan = await bachs.client.products.create({
      name: "Pro plan",
      price: { currency: "USD", amount: "10.00" },
      billing_cycle: { interval: "month", frequency: 1 },
    })

    expect(fixed).toMatchObject({
      name: "Ebook",
      status: "active",
      price: { price_type: "fixed", amount: "29.00", currency: "USD" },
    })
    expect(fixed.id).toMatch(/^prod_/)
    expect(custom.price).toMatchObject({
      price_type: "custom",
      preset_amount: "5000.00",
      minimum_amount: "1000.00",
    })
    expect(plan.billing_cycle).toEqual({ interval: "month", frequency: 1 })
    expect((await bachs.client.products.get(fixed.id)).name).toBe("Ebook")

    const page = await bachs.client.products.list({ limit: 2 })

    expect(page.items.map((item) => item.name)).toEqual(["Pro plan", "Tip jar"])
    expect(page.pagination).toMatchObject({ has_more: true, next_cursor: "cur_2", total: 3 })
    expect(
      (await bachs.client.products.list({ cursor: "cur_2" })).items.map((item) => item.name),
    ).toEqual(["Ebook"])
  })

  it("refuses products the way Bachs does", async () => {
    const noAmount = await bachs.call("POST", "/v1/products", {
      name: "Bad",
      price: { currency: "USD" },
    })

    expect(noAmount.status).toBe(400)
    expect(await noAmount.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
      detail: "price: amount is required for a fixed price.",
    })

    const noName = await bachs.call("POST", "/v1/products", {
      price: { currency: "USD", amount: "1.00" },
    })

    expect(await noName.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
      errors: [{ field: "name", type: "missing" }],
    })

    const trial = await bachs.call("POST", "/v1/products", {
      name: "Trial only",
      price: { currency: "USD", amount: "5.00" },
      trial_period: { interval: "day", frequency: 7 },
    })

    expect(trial.status).toBe(400)
    expect(await trial.json()).toMatchObject({ error_code: "TRIAL_REQUIRES_RECURRING" })
    await expect(codeOf(bachs.client.products.get("prod_missing"))).resolves.toBe("404 NOT_FOUND")
  })

  it("archives a product so it can no longer be sold, and keeps its cadence fixed", async () => {
    const plan = await bachs.client.products.create({
      name: "Pro plan",
      price: { currency: "USD", amount: "10.00" },
      billing_cycle: { interval: "month", frequency: 1 },
    })
    const archived = await (await bachs.call("POST", `/v1/products/${plan.id}/archive`)).json()

    expect(archived).toMatchObject({ status: "archived" })
    expect((await bachs.client.products.list()).items).toEqual([])
    expect((await bachs.client.products.list({ include_archived: true })).items).toHaveLength(1)

    const sale = await bachs.call("POST", "/v1/checkout-sessions", {
      product_cart: [{ product_id: plan.id }],
      customer: { email: "ada@danwo-shop.com", name: "Ada" },
    })

    expect(await sale.json()).toMatchObject({ error_code: "PRODUCT_ARCHIVED" })

    const changed = await bachs.call("PATCH", `/v1/products/${plan.id}`, {
      billing_cycle: { interval: "year", frequency: 1 },
    })

    expect(await changed.json()).toMatchObject({ error_code: "RECURRING_INTERVAL_IMMUTABLE" })
  })
})

describe("Bachs customers", () => {
  it("creates, finds and updates customers, and announces both", async () => {
    const created = await (
      await bachs.call("POST", "/v1/customers", {
        email: "jane@danwo-shop.com",
        name: "Jane Doe",
        metadata: { user_id: "usr_1" },
        billing_address: { line1: "40 Yaba Road", country: "NG" },
      })
    ).json()

    expect(created).toMatchObject({
      email: "jane@danwo-shop.com",
      billing_address: { line1: "40 Yaba Road", city: null, country: "NG" },
    })

    const id = String(created["customer_id"])
    const search = await (await bachs.call("GET", "/v1/customers?search=JANE@")).json()

    expect(search.items.map((item: { customer_id: string }) => item.customer_id)).toEqual([id])

    const updated = await (
      await bachs.call("PATCH", `/v1/customers/${id}`, {
        name: "Jane A. Doe",
        billing_address: { line1: "1 Main St", country: "GH" },
      })
    ).json()

    expect(updated).toMatchObject({
      name: "Jane A. Doe",
      billing_address: { line1: "1 Main St", country: "GH" },
    })
    expect(
      (await bachs.call("POST", "/v1/customers", { email: "jane@danwo-shop.com" })).status,
    ).toBe(409)

    await bachs.pass(0)
    expect(bachs.types()).toEqual(["customer.created", "customer.updated"])
  })

  it("refuses emails that are malformed, special-use or reserved for documentation", async () => {
    const create = async (email?: string) =>
      (await bachs.call("POST", "/v1/customers", { email, name: "Probe" })).json()

    expect(await create()).toEqual({
      detail: "Missing required field(s): email",
      error_code: "VALIDATION_ERROR",
      errors: [{ field: "email", message: "Field required", type: "missing" }],
    })
    expect(await create("nope")).toEqual({
      detail: "value is not a valid email address: An email address must have an @-sign.",
      error_code: "VALIDATION_ERROR",
    })
    expect(await create("ada@danwo.test")).toEqual({
      detail:
        "value is not a valid email address: The part after the @-sign is a special-use or reserved name that cannot be used with email.",
      error_code: "VALIDATION_ERROR",
    })
    expect(await create("ada@localhost")).toMatchObject({
      detail:
        "value is not a valid email address: The part after the @-sign is not valid. It should have a period.",
    })

    for (const email of ["jane@example.com", "jane@mail.example.org", "jane@shop.example"])
      expect(await create(email)).toEqual({
        detail: `'${email}' cannot receive mail — its domain accepts none. Receipts and payment notices would not arrive.`,
        error_code: "EMAIL_NOT_DELIVERABLE",
      })

    const ebook = await bachs.client.products.create({
      name: "Ebook",
      price: { currency: "USD", amount: "29.00" },
    })
    const sale = await bachs.call("POST", "/v1/checkout-sessions", {
      product_cart: [{ product_id: ebook.id }],
      customer: { email: "ada@shop.local" },
    })

    expect(await sale.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
      detail: expect.stringContaining("special-use"),
    })
  })

  it("mints a portal session whose URL opens the customer's billing page", async () => {
    const created = await (
      await bachs.call("POST", "/v1/customers", { email: "jane@danwo-shop.com" })
    ).json()
    const session = await bachs.client.customerPortal.createSession(String(created["customer_id"]))

    expect(session.id).toMatch(/^psn_/)
    expect(session.url).toMatch(/^https:\/\/portal\.bachs\.io\/s\//)

    const page = await bachs.emulator.fetch(new Request(session.url))

    expect(await page.text()).toContain("Signed in as jane@danwo-shop.com")
  })
})

describe("Bachs API conventions", () => {
  it("takes sandbox keys on the sandbox host only, and live keys on the live host only", async () => {
    const live = await bachs.emulator.fetch(
      new Request("https://api.bachs.io/v1/products", {
        headers: { authorization: "Bearer sk_sandbox_x" },
      }),
    )
    const sandbox = await bachs.emulator.fetch(
      new Request("https://sandbox-api.bachs.io/v1/products", {
        headers: { authorization: "Bearer sk_live_x" },
      }),
    )
    const none = await bachs.emulator.fetch(new Request("https://sandbox-api.bachs.io/v1/products"))

    for (const response of [live, sandbox, none]) {
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error_code: "UNAUTHORIZED" })
    }
  })

  it("replays a write under the same Idempotency-Key and refuses the key for a different request", async () => {
    const send = (name: string) =>
      bachs.emulator.fetch(
        new Request("https://sandbox-api.bachs.io/v1/products", {
          method: "POST",
          headers: { authorization: "Bearer sk_sandbox_x", "Idempotency-Key": "create-ebook" },
          body: JSON.stringify({ name, price: { currency: "USD", amount: "29.00" } }),
        }),
      )
    const first = await (await send("Ebook")).json()
    const again = await send("Ebook")

    expect(again.status).toBe(201)
    expect((await again.json())["id"]).toBe(first["id"])
    expect((await bachs.client.products.list()).items).toHaveLength(1)

    const other = await send("Other")

    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ error_code: "IDEMPOTENCY_CONFLICT" })
  })

  it("answers malformed cursors and unknown resources in Bachs's error shape", async () => {
    const cursor = await bachs.call("GET", "/v1/products?cursor=page2")

    expect(await cursor.json()).toEqual({
      detail: "Invalid cursor format. Expected 'cur_<offset>'.",
      error_code: "BAD_REQUEST",
    })
    expect(cursor.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  })
})
