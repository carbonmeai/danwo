import { defineConfig } from "@danwo/sdk"

import { pageEnvironment } from "../page-server.ts"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  model: "openai/gpt-5-mini",
  cache: { dir: ".danwo-cache" },
  environment: ({ workerIndex }) => pageEnvironment(workerIndex),
})
