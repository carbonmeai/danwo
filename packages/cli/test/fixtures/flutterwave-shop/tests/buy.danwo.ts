import { type FlutterwaveFixtures, flutterwaveLedger, test as base, z } from "@danwo/sdk"

const test = base.extend<FlutterwaveFixtures>()

test("buys 500 credits on Flutterwave's hosted page with the PIN test card", async ({
  app,
  screen,
  settle,
  expect,
}) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await screen.getByLabel("Card number").fill("5531886652142950")
  await screen.getByLabel("Expiry date").fill("09/32")
  await screen.getByLabel("CVV").fill("564")
  await screen.getByRole("button", { name: "Pay NGN 7,500.00" }).click()
  await screen.getByLabel("Card PIN").fill("3310")
  await screen.getByRole("button", { name: "Submit PIN" }).click()
  await screen.getByLabel("OTP").fill("12345")
  await screen.getByRole("button", { name: "Verify OTP" }).click()
  await expect(screen.getByRole("heading", { name: "Payment received" })).toBeVisible()
  await settle()
  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("Credits: 500")
}).invariant(async ({ app, flutterwave, settle, expect }) => {
  /*
   * Whichever way the run went, the app never holds more credits than Flutterwave was paid for: a
   * webhook sent twice, or a forged one, must not credit a payment twice.
   */
  await settle()

  const payments = flutterwaveLedger(flutterwave).transactions()
  const paid = payments.filter((tx) => tx.status === "successful").length
  const books = z.object({ credits: z.number() })
  const held = books.parse(await (await fetch(new URL("/credits.json", app.baseUrl))).json())

  expect(held.credits).toBeLessThanOrEqual(500 * paid)
})
