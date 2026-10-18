import { defineConfig } from "@pandacss/dev"

import { danwoUi } from "./src/theme/preset"

/** The danwo design system: tokens, recipes and components the dashboard and other danwo apps share. */
export default defineConfig({
  preflight: true,
  jsxFramework: "react",
  include: ["./src/**/*.{ts,tsx}"],
  exclude: ["./src/**/*.spec.{ts,tsx}"],
  importMap: "@danwo/ui",
  outdir: "./styled-system",
  prefix: "danwo",
  presets: ["@pandacss/preset-base", danwoUi],
})
