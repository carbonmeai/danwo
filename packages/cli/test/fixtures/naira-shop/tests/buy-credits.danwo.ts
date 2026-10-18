import { type PaystackFixtures, paystackLedger, test as base } from "@danwo/sdk"

const test = base.extend<PaystackFixtures>()

test("buys 500 credits with a card on Paystack's page", async ({ app, screen, settle, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await expect(screen.getByTestId("amount")).toHaveText("Pay ₦5,000.00")
  await screen.getByLabel("Card number").fill("4084 0840 8408 4081")
  await screen.getByLabel("Expiry (MM/YY)").fill("12/30")
  await screen.getByLabel("CVV").fill("408")
  await screen.getByRole("button", { name: "Pay ₦5,000.00" }).click()
  await expect(screen.getByRole("heading", { name: "Payment confirmed" })).toBeVisible()
  await settle()
  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("Credits: 500")
}).invariant(async ({ app, screen, paystack, settle, expect }) => {
  /*
   * Whichever way the run went, the shop grants exactly one pack per payment Paystack took: an
   * event sent twice must not pay out twice, and nothing is granted for a payment that never happened.
   */
  await settle()
  await app.open("/")

  const packs = paystackLedger(paystack).successful("NGN").length

  await expect(screen.getByRole("status")).toHaveText(`Credits: ${500 * packs}`)
})
