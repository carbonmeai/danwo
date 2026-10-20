import { defineConfig } from "@danwo/sdk"

import { connectEnvironment } from "./sites.ts"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  readiness: "page",
  record: { mode: "always" },
  video: "on",
  environment: () => connectEnvironment(),
})
