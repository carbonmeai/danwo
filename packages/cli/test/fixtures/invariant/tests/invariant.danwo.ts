import { test } from "@danwo/sdk"

test("passes its body but not its invariant", async ({ app }) => {
  await app.open("/")
}).invariant(({ expect }) => {
  expect(1 + 1).toBe(3)
})
