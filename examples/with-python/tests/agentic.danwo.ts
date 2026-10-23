/**
 * The agent books like a person would, from a plain-English goal. Each test is paired with a check
 * that needs no model: the invariant, or a value compared with the database. They skip without a
 * model key; once recorded, they replay with no model at all.
 */
import { test as base, z } from "@danwo/sdk"

import { bookingNumber, CUSTOMER, expectBooksBalance, type StudioFixtures } from "./studio.ts"

const test = base.extend<StudioFixtures>()

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test("books the cheapest class", { skip }, async ({ app, agent }) => {
  await app.open("/")
  await agent.act(
    "book a place in the cheapest class on the timetable with the email {email}, and pay with Stripe's test card",
    { params: { email: "lou@fernstudio.test" } },
  )
  await agent.assert("the booking is confirmed", { poll: true })
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)

  // The model-free half: whatever the agent clicked, its one booking is for the cheapest class.
  const booked = await fixtures.sql<{ slug: string }>(
    "select c.slug from bookings b join classes c on c.id = b.class_id where b.email = $1",
    ["lou@fernstudio.test"],
  )

  fixtures.expect(booked).toEqual([{ slug: "breathwork" }])
})

test(
  "finds my booking",
  { skip, session: "returning-customer" },
  async ({ app, agent, sql, expect }) => {
    await app.open("/")
    await agent.act("find my bookings")

    const { number } = await agent.extract(
      "the number of the most recent booking, such as FS-1001",
      z.object({ number: z.string() }),
    )
    const [latest] = await sql<{ id: number }>(
      "select id from bookings where email = $1 order by id desc limit 1",
      [CUSTOMER],
    )

    // The model-free half: the number on the page is the customer's latest booking in the database.
    expect(number).toBe(bookingNumber(latest?.id ?? 0))
  },
)
