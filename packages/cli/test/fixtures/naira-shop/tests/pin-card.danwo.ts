import { type PaystackFixtures, test as base } from "@danwo/sdk"

const test = base.extend<PaystackFixtures>()

test("pays with a card that asks for its PIN and then an OTP", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await screen.getByLabel("Card number").fill("5078 5078 5078 5078 12")
  await screen.getByLabel("Expiry (MM/YY)").fill("12/30")
  await screen.getByLabel("CVV").fill("081")
  await screen.getByRole("button", { name: "Pay ₦5,000.00" }).click()
  await screen.getByLabel("Card PIN").fill("0000")
  await screen.getByRole("button", { name: "Continue" }).click()
  await expect(screen.getByRole("alert")).toHaveText("Incorrect PIN")
  await screen.getByLabel("Card PIN").fill("1111")
  await screen.getByRole("button", { name: "Continue" }).click()
  await screen.getByLabel("OTP").fill("123456")
  await screen.getByRole("button", { name: "Authorize" }).click()
  await expect(screen.getByRole("heading", { name: "Payment confirmed" })).toBeVisible()
})
