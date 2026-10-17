import { expect, testWith } from "@danwo/playwright"
import type { StripeFixtures } from "@danwo/sdk"

const test = testWith<StripeFixtures>()

test("grants credits once when Stripe delivers the payment twice", async ({ page, danwo }) => {
  danwo.inject("duplicate on webhook checkout.session.completed")

  await page.goto("/")
  await page.getByRole("button", { name: "Buy 500 credits" }).click()
  await page.getByTestId("checkout-pay").click()
  await expect(page.getByRole("heading", { name: "Thank you for your purchase" })).toBeVisible()
  await danwo.settle()

  const deliveries = danwo.deliveries().filter((d) => d.topic === "checkout.session.completed")

  expect(deliveries.some((d) => d.fault === "duplicate")).toBe(true)
  await expect(page.getByText(/^Credits: /)).toHaveText("Credits: 500")
})
