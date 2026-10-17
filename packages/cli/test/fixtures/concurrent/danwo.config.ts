import { defineConfig } from "@danwo/sdk"

import { pageEnvironment } from "../page-server.ts"

// Each test waits for the other one to have started, so they only pass when run at the same time.
export default defineConfig({
  testDir: "tests",
  timeout: 15_000,
  environment: ({ workerIndex }) => pageEnvironment(workerIndex),
})
