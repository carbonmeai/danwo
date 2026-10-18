import { type StripeFixtures, test as base, z } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()

const Orders = z.object({ orders: z.number() })
const Intents = z.object({ data: z.array(z.object({ id: z.string() })) })

test("places one paid order", async ({ app, expect }) => {
  const placed = await fetch(new URL("/orders", app.baseUrl), { method: "POST" })

  expect(placed.ok).toBe(true)
}).invariant(async ({ app, stripe, expect }) => {
  const saved = Orders.parse(await (await fetch(new URL("/orders", app.baseUrl))).json()).orders
  const listed = await stripe.fetch(
    new Request("https://api.stripe.com/v1/payment_intents?limit=100", {
      headers: { authorization: "Bearer sk_test_danwo_orders" },
    }),
  )
  const intents = Intents.parse(await listed.json()).data.length

  // Every saved order was paid for, and each run starts from an empty orders table.
  expect(saved).toBeLessThanOrEqual(intents)
  expect(saved).toBeLessThanOrEqual(1)
})
