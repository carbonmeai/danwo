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
  globalCss: {
    ":root": {
      "--font-sans": "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
      "--font-mono": "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    "html, body": {
      bg: "signal.ground",
      color: "signal.ink",
      height: "auto",
      minHeight: "100%",
      overflow: "auto",
      fontFeatureSettings: "'tnum' 1, 'cv01' 1",
      WebkitFontSmoothing: "antialiased",
    },
    body: { fontSize: "1.5", lineHeight: "1.5" },
    a: {
      color: "signal.accent",
      textUnderlineOffset: "3px",
      _hover: { textDecoration: "underline" },
    },
    "a:focus-visible, button:focus-visible, summary:focus-visible, [tabindex]:focus-visible": {
      outline: "2px solid {colors.signal.focus}",
      outlineOffset: "2px",
      borderRadius: "4px",
    },
    "@media (prefers-reduced-motion: reduce)": {
      "*, *::before, *::after": { animationDuration: "0.01ms", transitionDuration: "0.01ms" },
    },
  },
})
