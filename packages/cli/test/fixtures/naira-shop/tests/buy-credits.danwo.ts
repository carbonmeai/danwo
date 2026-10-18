import { type PaystackFixtures, paystackLedger, test as base } from "@danwo/sdk"

import { buyCredits, expectCredits } from "../../hosted-checkout.ts"

const test = base.extend<PaystackFixtures>()

test("buys 500 credits with a card on Paystack's page", async (fixtures) => {
  const { screen, expect } = fixtures

  await buyCredits(
    fixtures,
    async () => {
      await expect(screen.getByTestId("amount")).toHaveText("Pay ₦5,000.00")
      await screen.getByLabel("Card number").fill("4084 0840 8408 4081")
      await screen.getByLabel("Expiry (MM/YY)").fill("12/30")
      await screen.getByLabel("CVV").fill("408")
      await screen.getByRole("button", { name: "Pay ₦5,000.00" }).click()
    },
    "Payment confirmed",
  )
}).invariant(async (fixtures) => {
  /*
   * Whichever way the run went, the shop grants exactly one pack per payment Paystack took: an
   * event sent twice must not pay out twice, and nothing is granted for a payment that never happened.
   */
  await fixtures.settle()
  await expectCredits(fixtures, paystackLedger(fixtures.paystack).successful("NGN").length)
})
