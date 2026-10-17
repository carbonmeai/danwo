import { type StripeFixtures, test as base } from "@danwo/sdk"

import { grantedCredits, paidCredits } from "../src/ledger.ts"

const test = base.extend<StripeFixtures>()

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
  expect(await grantedCredits(app.baseUrl, "u1")).toBe(await paidCredits(stripe, "u1"))
})
