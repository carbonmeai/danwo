import { test } from "@danwo/sdk"

test("buys 500 credits through Stripe Checkout", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await screen.getByTestId("checkout-pay").click()
  await expect(screen.getByRole("heading", { name: "Thank you for your purchase" })).toBeVisible()
  await expect(screen.getByRole("status")).toHaveText("Credits: 500")
})
