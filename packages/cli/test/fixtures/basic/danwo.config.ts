import { defineConfig } from "@danwo/sdk"

import { pageEnvironment } from "../page-server.ts"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  environment: ({ workerIndex }) => pageEnvironment(workerIndex),
})
