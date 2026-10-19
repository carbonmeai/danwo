import { type StripeFixtures, test as base } from "@danwo/sdk"
import { z } from "zod"

import { grantedCredits, paidCredits } from "../../shop/src/ledger.ts"

const test = base.extend<StripeFixtures>()

/*
 * The same purchase, told in plain words. The first run with a model (`DANWO_MODEL`) records each
 * step under `tests/__recordings__`; later runs, and every `danwo matrix` trial, replay them with
 * no model call.
 */
test("buys 500 credits when asked in plain words", async ({ agent, screen, expect }) => {
  /* The worker's shop keeps its credits from test to test; this purchase adds 500. */
  const { credits } = await agent.extract(
    "the credits balance",
    z.object({ credits: z.number().int() }),
  )

  await agent.act("Start buying 500 credits")
  await expect(screen.getByText("Pay danwo")).toBeVisible()

  await agent.act("Pay for the credits with the email {email}", {
    params: { email: "buyer@example.com" },
  })
  await expect(screen.getByTestId("status")).toHaveText("Thanks for your order")
  await expect(screen.getByTestId("credits")).toHaveText(`Credits: ${credits + 500}`)
}).invariant(async ({ app, stripe, expect }) => {
  expect(await grantedCredits(app.baseUrl, "u1")).toBe(await paidCredits(stripe, "u1"))
})
