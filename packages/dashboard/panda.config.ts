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
      "--font-sans":
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      "--font-mono": "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    },
    "html, body": {
      bg: "surface.page",
      color: "ink.strong",
      height: "auto",
      minHeight: "100%",
      overflow: "auto",
      fontFeatureSettings: "'cv11', 'ss01'",
      WebkitFontSmoothing: "antialiased",
    },
    body: { fontSize: "1.5", lineHeight: "1.45" },
    a: { color: "inherit", textDecoration: "none" },
    /** A link in running text, marked `data-link` or inside `data-prose`: underlined lightly. */
    "a[data-link], [data-prose] a": {
      color: "ink.strong",
      fontWeight: "500",
      textDecoration: "underline",
      textDecorationColor: "ink.faint",
      textUnderlineOffset: "3px",
      _hover: { textDecorationColor: "currentColor" },
    },
    "a:focus-visible, button:focus-visible, summary:focus-visible, [tabindex]:focus-visible": {
      outline: "none",
      boxShadow: "0 0 0 3px {colors.ring}",
      borderRadius: "8px",
    },
    "@media (prefers-reduced-motion: reduce)": {
      "*, *::before, *::after": { animationDuration: "0.01ms", transitionDuration: "0.01ms" },
    },
  },
})
