import { type BachsFixtures, bachsLedger, test as base } from "@danwo/sdk"

const test = base.extend<BachsFixtures>()

test("buys 500 credits through Bachs's hosted checkout", async ({
  app,
  screen,
  settle,
  expect,
}) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await screen.getByTestId("bachs-pay").click()
  await expect(screen.getByRole("heading", { name: "Thanks for your order" })).toBeVisible()
  await settle()
  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("Credits: 500")
}).invariant(async ({ app, screen, bachs, settle, expect }) => {
  /*
   * Whichever way the run went, the app grants exactly 500 credits for every payment Bachs
   * collected: a delivery sent twice must not grant twice.
   */
  await settle()
  await app.open("/")

  const collected = bachsLedger(bachs).succeeded().length

  expect(await screen.getByRole("status").innerText()).toBe(`Credits: ${500 * collected}`)
})
