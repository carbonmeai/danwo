import { type BachsFixtures, bachsLedger, test as base } from "@danwo/sdk"

import { buyCredits, expectCredits } from "../../hosted-checkout.ts"

const test = base.extend<BachsFixtures>()

test("buys 500 credits through Bachs's hosted checkout", async (fixtures) => {
  await buyCredits(
    fixtures,
    () => fixtures.screen.getByTestId("bachs-pay").click(),
    "Thanks for your order",
  )
}).invariant(async (fixtures) => {
  /*
   * Whichever way the run went, the app grants exactly 500 credits for every payment Bachs
   * collected: a delivery sent twice must not grant twice.
   */
  await fixtures.settle()
  await expectCredits(fixtures, bachsLedger(fixtures.bachs).succeeded().length)
})
