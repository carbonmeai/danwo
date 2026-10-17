import { defineConfig } from "vitest/config"

/*
 * `unit` runs in `bun run check`; `slow` (whole-stack browser matrices, minutes) runs with
 * `bun run test:slow` and in CI.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: ["**/*.slow.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "slow",
          include: ["packages/*/test/**/*.slow.test.ts"],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
