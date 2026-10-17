import { defineConfig } from "@danwo/sdk"

import { PANTRY_SECRET, pantryEnvironment } from "./site.ts"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  secrets: { pantryKey: PANTRY_SECRET },
  environment: () => pantryEnvironment(),
})
