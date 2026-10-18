import { defineConfig } from "@pandacss/dev"

/** The dashboard's styles: danwo's design system plus whatever the dashboard's own files use. */
export default defineConfig({
  preflight: true,
  jsxFramework: "react",
  designSystem: "@danwo/ui",
  include: ["./src/**/*.{ts,tsx}"],
  exclude: ["./src/styled-system/**"],
  outdir: "./src/styled-system",
  prefix: "danwo",
})
