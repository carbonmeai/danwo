import { defineConfig } from "vitest/config"

import { uiSourceAlias } from "./packages/ui/source-alias.ts"

/*
 * `unit` and `ui` run in `bun run check`; `slow` (whole-stack browser matrices, minutes) runs with
 * `bun run test:slow` and in CI. `ui` needs the design system's generated styles, which
 * `bun run ui:codegen` writes.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "benchmarks/test/**/*.test.ts"],
          exclude: ["**/*.slow.test.ts", "**/node_modules/**"],
        },
      },
      {
        resolve: { alias: [uiSourceAlias] },
        test: {
          name: "ui",
          include: ["packages/ui/src/**/*.spec.ts", "packages/dashboard/src/**/*.spec.ts"],
          exclude: ["**/node_modules/**"],
        },
      },
      {
        test: {
          name: "slow",
          include: ["packages/*/test/**/*.slow.test.ts", "benchmarks/test/**/*.slow.test.ts"],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
