import { type StripeFixtures, test as base } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()

test("a Pro subscription bought through Checkout renews a month later", async ({
  app,
  screen,
  expect,
  time,
  settle,
}) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Subscribe to Pro" }).click()
  await screen.getByTestId("checkout-pay").click()
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: active")
  await expect(screen.getByTestId("invoices")).toHaveText("Invoices: 1")

  /* A month on, the renewal invoice is paid and the plan stays active. */
  await time.travel({ days: 32 })
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: active")
  await expect(screen.getByTestId("invoices")).toHaveText("Invoices: 2")
  await expect(screen.getByText("subscription_cycle")).toBeVisible()
})
