import type { DeviceFixtures } from "@danwo/device"
import { type StripeFixtures, test as base } from "@danwo/sdk"

import { grantedCredits, paidCredits } from "../../shop/src/ledger.ts"

const test = base.extend<StripeFixtures & DeviceFixtures>()

test("buys 500 credits through Stripe Checkout in the in-app browser", async ({
  screen,
  expect,
  device,
}) => {
  /* By its text: iOS's driver reports no heading role. */
  await expect(screen.getByText("Danwo Shop")).toBeVisible()
  await expect(screen.getByTestId("credits")).toHaveText(/^Credits: \d+$/)

  /* The worker's shop keeps its credits from test to test; this purchase adds 500. */
  const before = Number((await screen.getByTestId("credits").innerText()).replace(/\D/g, ""))

  await screen.getByTestId("buy").tap()

  /* Checkout opens over the app (a Custom Tab, or a Safari view on iOS); the same locators read the page. */
  await expect(screen.getByText("Pay danwo")).toBeVisible()
  expect((await device.foreground()).browser).toBe(true)
  await screen.getByLabel("Email").fill("buyer@example.com")
  /* Paying calls Stripe; readiness waits for the call and plays the webhook it causes. */
  await screen.getByRole("button", { name: "Pay $5.00" }).tap()

  /* Checkout returns to the app through `danwoshop://done`. */
  await expect(screen.getByTestId("status")).toHaveText("Thanks for your order")
  await expect(screen.getByTestId("credits")).toHaveText(`Credits: ${before + 500}`)
}).invariant(async ({ app, stripe, expect }) => {
  /* However the purchase went on the device, credits match the paid Checkout Sessions. */
  const paid = await paidCredits(stripe, "u1")

  expect(await grantedCredits(app.baseUrl, "u1")).toBe(paid)
})
