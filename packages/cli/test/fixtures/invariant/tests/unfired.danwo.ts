import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { type StripeFixtures, test as base } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()
const marker = join(process.env.DANWO_FIXTURE_STATE ?? ".", "created-customer")

// Only the first (clean) run creates a customer, so faults planned on its webhook never fire.
test("creates a customer on its first run only", async ({ stripe, settle }) => {
  if (!existsSync(marker)) {
    writeFileSync(marker, "")
    await stripe.fetch(
      new Request("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          authorization: "Bearer sk_test_danwo_fixture",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "email=qa%40danwo.test",
      }),
    )
  }

  await settle()
})
