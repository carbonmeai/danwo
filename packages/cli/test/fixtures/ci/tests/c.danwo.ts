import { test } from "@danwo/sdk"

test("c opens the page", async ({ app }) => {
  await app.open("/")

  if (process.env.CI_FIXTURE_FAIL_C === "1") throw new Error("c was told to fail")
})
