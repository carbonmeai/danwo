import { test } from "@danwo/sdk"

test("runs past its own timeout", { timeout: 1_000 }, async () => {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
})
