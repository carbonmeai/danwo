import { test } from "@danwo/sdk"

test("b fails when told to", async ({ app }) => {
  await app.open("/")

  if (process.env.CI_FIXTURE_FAIL === "1") throw new Error("b was told to fail")
})
