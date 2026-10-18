import type { DeviceFixtures } from "@danwo/device"
import { type StripeFixtures, test as base } from "@danwo/sdk"

import { grantedCredits, paidCredits } from "../../shop/src/ledger.ts"

const test = base.extend<StripeFixtures & DeviceFixtures>()

test("buys 500 credits through Stripe Checkout in a Custom Tab", async ({
  screen,
  expect,
  device,
}) => {
  await expect(screen.getByRole("heading", { name: "Danwo Shop" })).toBeVisible()
  await expect(screen.getByTestId("credits")).toHaveText("Credits: 0")

  await screen.getByTestId("buy").tap()

  /* Checkout opens in a Custom Tab over the app; the same locators read the web page. */
  await expect(screen.getByText("Pay danwo")).toBeVisible()
  expect((await device.foreground()).browser).toBe(true)
  await screen.getByLabel("Email").fill("buyer@example.com")
  /* Paying calls Stripe; readiness waits for the call and plays the webhook it causes. */
  await screen.getByRole("button", { name: "Pay $5.00" }).tap()

  /* Checkout returns to the app through `danwoshop://done`. */
  await expect(screen.getByTestId("status")).toHaveText("Thanks for your order")
  await expect(screen.getByTestId("credits")).toHaveText("Credits: 500")
}).invariant(async ({ app, stripe, expect }) => {
  /* However the purchase went on the device, credits match the paid Checkout Sessions. */
  const paid = await paidCredits(stripe, "u1")

  expect(await grantedCredits(app.baseUrl, "u1")).toBe(paid)
})
