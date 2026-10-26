import { defineConfig } from "vitest/config"

import { uiSourceAlias } from "./packages/ui/source-alias.ts"

/*
 * `unit` and `ui` run in `bun run check`; `slow` (whole-stack browser matrices, minutes) runs with
 * `bun run test:slow` and in CI. `ui` needs the design system's generated styles, which
 * `bun run ui:codegen` writes.
 */
/**
 * Windows starts processes and reads files slower (antivirus scans each one), so tests that start
 * an app or a browser get more time there.
 */
const TIMEOUTS = process.platform === "win32" ? { testTimeout: 30_000, hookTimeout: 60_000 } : {}

export default defineConfig({
  test: {
    // Fails a run that leaves anything behind in the examples or fixtures, or any process running.
    globalSetup: ["./scripts/untouched-examples.ts", "./scripts/no-leftover-processes.ts"],
    projects: [
      {
        test: {
          name: "unit",
          ...TIMEOUTS,
          include: [
            "packages/*/test/**/*.test.ts",
            "scripts/test/**/*.test.ts",
            "benchmarks/test/**/*.test.ts",
            "website/test/**/*.test.ts",
          ],
          exclude: ["**/*.slow.test.ts", "**/node_modules/**"],
        },
      },
      {
        resolve: { alias: [uiSourceAlias] },
        test: {
          name: "ui",
          ...TIMEOUTS,
          include: ["packages/ui/src/**/*.spec.ts", "packages/dashboard/src/**/*.spec.ts"],
          exclude: ["**/node_modules/**"],
        },
      },
      {
        test: {
          name: "slow",
          include: ["packages/*/test/**/*.slow.test.ts", "benchmarks/test/**/*.slow.test.ts"],
          setupFiles: ["./scripts/outside-ci.ts"],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
