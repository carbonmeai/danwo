import { type StripeFixtures, test as base, z } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()

const PaidSessions = z.object({
  data: z.array(
    z.object({
      client_reference_id: z.string().nullable(),
      metadata: z.record(z.string(), z.string()).nullable(),
    }),
  ),
})
const Credits = z.object({ credits: z.number() })

/** Credits Stripe took payment for: the paid checkout sessions of `user`, read from the emulator. */
async function paidCredits(stripe: StripeFixtures["stripe"], user: string): Promise<number> {
  const res = await stripe.fetch(
    new Request("https://api.stripe.com/v1/checkout/sessions?payment_status=paid&limit=100", {
      headers: { authorization: "Bearer sk_test_danwo_example" },
    }),
  )
  const { data } = PaidSessions.parse(await res.json())

  return data
    .filter((session) => session.client_reference_id === user)
    .reduce((sum, session) => sum + Number(session.metadata?.credits ?? 0), 0)
}

test("buys 500 credits through Stripe Checkout", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()

  await expect(screen.getByTestId("checkout-total")).toContainText("$5.00")
  /* Paying calls Stripe; readiness waits for the call and plays the webhook it causes. */
  await screen.getByTestId("checkout-pay").click()

  await expect(screen.getByRole("heading", { name: "Thank you for your purchase" })).toBeVisible()
  await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 500")
}).invariant(async ({ app, stripe, expect }) => {
  // Whichever way the purchase went, the shop grants exactly the credits Stripe was paid for.
  const res = await fetch(`${app.baseUrl}/credits?user=u1`)
  const { credits } = Credits.parse(await res.json())

  expect(credits).toBe(await paidCredits(stripe, "u1"))
})
