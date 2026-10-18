import { defineConfig } from "@danwo/sdk"

import { pageEnvironment } from "../page-server.ts"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  environment: ({ workerIndex }) => pageEnvironment(workerIndex),
  // The app's pages live under `app/`: a change there affects every test that visited a page.
  impact: { rules: { "app/**": ["/"] } },
})
