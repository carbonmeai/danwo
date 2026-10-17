import type { DanwoWorkerFixtures } from "@danwo/playwright"
import { defineConfig } from "@playwright/test"

/** Every worker starts the shop's danwo environment: the shop, a Stripe emulator and the proxy. */
export default defineConfig<object, Pick<DanwoWorkerFixtures, "danwoConfig">>({
  testDir: "tests",
  timeout: 60_000,
  use: { danwoConfig: "../shop/danwo.config.ts" },
})
