/**
 * The agent shops like a person would, from a plain-English goal. Each test is paired with a check
 * that needs no model: the invariant, or a value compared with the database. They skip without a
 * model key; once recorded, they replay with no model at all.
 */
import { test as base, z } from "@danwo/sdk"

import { CUSTOMER, expectBooksBalance, orderNumber, type ShopFixtures } from "./shop.ts"

const test = base.extend<ShopFixtures>()

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test("buys the cheapest mug", { skip }, async ({ app, agent }) => {
  await app.open("/")
  await agent.act(
    "buy the cheapest mug in the shop, one of it, with the email {email}, and pay with Stripe's test card",
    { params: { email: "lou@paperandclay.test" } },
  )
  await agent.assert("the order is confirmed", { poll: true })
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)

  // The model-free half: whatever the agent clicked, the one order holds the cheapest mug.
  const lines = await fixtures.sql<{ name: string; quantity: number }>(
    "select i.name, i.quantity from order_items i join orders o on o.id = i.order_id where o.email = $1",
    ["lou@paperandclay.test"],
  )

  fixtures.expect(lines).toEqual([{ name: "Little mug", quantity: 1 }])
})

test(
  "finds my last order",
  { skip, session: "returning-customer" },
  async ({ app, agent, sql, expect }) => {
    await app.open("/")
    await agent.act("find my most recent order")

    const { number } = await agent.extract(
      "the number of the most recent order, such as PC-1001",
      z.object({ number: z.string() }),
    )
    const [latest] = await sql<{ id: number }>(
      "select id from orders where email = $1 order by id desc limit 1",
      [CUSTOMER],
    )

    // The model-free half: the number on the page is the customer's latest order in the database.
    expect(number).toBe(orderNumber(latest?.id ?? 0))
  },
)
