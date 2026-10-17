import { expect, testWith } from "@danwo/playwright"
import type { StripeFixtures } from "@danwo/sdk"

import { grantedCredits, paidCredits } from "../../shop/src/ledger.ts"

const test = testWith<StripeFixtures>()

// Whichever way the purchase went, the shop grants exactly the credits Stripe was paid for.
test.invariant(async ({ danwo, baseURL }) => {
  expect(await grantedCredits(baseURL ?? "", "u1")).toBe(await paidCredits(danwo.stripe, "u1"))
})

test("buys 500 credits through Stripe Checkout", async ({ page, danwo }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Buy 500 credits" }).click()

  await expect(page.getByTestId("checkout-total")).toContainText("$5.00")
  await page.getByTestId("checkout-pay").click()

  await expect(page.getByRole("heading", { name: "Thank you for your purchase" })).toBeVisible()
  // Credits arrive by webhook; play the deliveries on the emulator's clock.
  await danwo.settle()
  await expect(page.getByText(/^Credits: /)).toHaveText("Credits: 500")
})
