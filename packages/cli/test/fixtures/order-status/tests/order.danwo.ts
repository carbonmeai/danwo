import { type StripeFixtures, test as base, z } from "@danwo/sdk"

import { fakeKey } from "../../fake-key.ts"

const test = base.extend<StripeFixtures>()

/** Each payment intent's status, as the shop reports it. */
const Orders = z.record(z.string(), z.enum(["pending", "paid"]))
/** Stripe's payment intents, as the emulator lists them. */
const Intents = z.object({ data: z.array(z.object({ id: z.string(), status: z.string() })) })

test("pays for a lamp and sees the order paid", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy a lamp" }).click()
  await screen.getByRole("button", { name: "Pay $42.00" }).click()
  await expect(screen.getByRole("status")).toHaveText("Order paid")
}).invariant(async ({ app, stripe, expect }) => {
  /*
   * Whatever order Stripe's events arrived in, an order whose payment succeeded reads paid, and
   * none reads paid that Stripe did not take.
   */
  const listed = await stripe.fetch(
    new Request("https://api.stripe.com/v1/payment_intents?limit=100", {
      headers: { authorization: `Bearer ${fakeKey("sk_", "test_orderstatusorderstatus")}` },
    }),
  )
  const intents = Intents.parse(await listed.json()).data
  const orders = Orders.parse(await (await fetch(new URL("/orders.json", app.baseUrl))).json())

  const paid = intents.filter((intent) => intent.status === "succeeded").map((intent) => intent.id)
  const shownPaid = Object.keys(orders).filter((id) => orders[id] === "paid")

  expect(shownPaid.toSorted()).toEqual(paid.toSorted())
})
