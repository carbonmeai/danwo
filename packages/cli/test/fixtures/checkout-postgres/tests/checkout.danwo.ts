import { type StripeFixtures, test as base, z } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()

const State = z.object({ orders: z.number(), stock: z.number() })
const Intents = z.object({ data: z.array(z.object({ id: z.string() })) })

test("buys a lamp once", async ({ app, expect }) => {
  const placed = await fetch(new URL("/checkout", app.baseUrl), {
    method: "POST",
    headers: { "checkout-key": "chk_lamp_ada" },
  })

  expect(placed.status).toBe(201)
}).invariant(async ({ app, stripe, expect }) => {
  const state = State.parse(await (await fetch(new URL("/state", app.baseUrl))).json())
  const listed = await stripe.fetch(
    new Request("https://api.stripe.com/v1/payment_intents?limit=100", {
      headers: { authorization: "Bearer sk_test_danwo_checkout" },
    }),
  )
  const charges = Intents.parse(await listed.json()).data.length

  // One charge, one order, one lamp gone: never charged without an order, never twice.
  expect(charges).toBe(state.orders)
  expect(state.orders).toBeLessThanOrEqual(1)
  expect(state.stock).toBe(5 - state.orders)
})
