import { test } from "@danwo/sdk"

test.only("focused while debugging", async ({ app }) => {
  await app.open("/")
})

test("left out by the focus", async ({ app }) => {
  await app.open("/")
})
