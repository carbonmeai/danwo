import { type FlutterwaveFixtures, flutterwaveLedger, test as base, z } from "@danwo/sdk"

import { buyCredits } from "../../hosted-checkout.ts"

const test = base.extend<FlutterwaveFixtures>()

/** The shop's books, as its `/credits.json` reports them. */
const Books = z.object({ credits: z.number() })

test("buys 500 credits on Flutterwave's hosted page with the PIN test card", async (fixtures) => {
  const { screen } = fixtures

  await buyCredits(
    fixtures,
    async () => {
      await screen.getByLabel("Card number").fill("5531886652142950")
      await screen.getByLabel("Expiry date").fill("09/32")
      await screen.getByLabel("CVV").fill("564")
      await screen.getByRole("button", { name: "Pay NGN 7,500.00" }).click()
      await screen.getByLabel("Card PIN").fill("3310")
      await screen.getByRole("button", { name: "Submit PIN" }).click()
      await screen.getByLabel("OTP").fill("12345")
      await screen.getByRole("button", { name: "Verify OTP" }).click()
    },
    "Payment received",
  )
}).invariant(async ({ app, flutterwave, settle, expect }) => {
  /*
   * Whichever way the run went, the app never holds more credits than Flutterwave was paid for: a
   * webhook sent twice, or a forged one, must not credit a payment twice.
   */
  await settle()

  const payments = flutterwaveLedger(flutterwave).transactions()
  const paid = payments.filter((tx) => tx.status === "successful").length
  const held = Books.parse(await (await fetch(new URL("/credits.json", app.baseUrl))).json())

  expect(held.credits).toBeLessThanOrEqual(500 * paid)
})
