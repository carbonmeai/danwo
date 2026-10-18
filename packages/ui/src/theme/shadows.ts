import { defineSemanticTokens, defineTokens } from "@pandacss/dev"

export const shadows = defineTokens.shadows({
  "2xl": {
    value: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
  },
  dark2xl: {
    value: "0 25px 50px -12px rgba(57, 55, 63, 0.25)",
  },
  darkInnerLeft: {
    value: "inset 9px 0 6px -1px rgb(57 55 63 / 0.02)",
  },
  darkInnerRight: {
    value: "inset -9px 0 6px -1px rgb(57 55 63 / 0.02)",
  },
  darkLg: {
    value: "0 10px 15px -3px rgba(57, 55, 63, 0.1)",
  },
  darkMd: {
    value: "0 4px 6px -1px rgba(57, 55, 63, 0.1)",
  },
  darkSm: {
    value: "0 1px 3px 0 rgba(57, 55, 63, 0.1)",
  },
  darkXl: {
    value: "0 20px 25px -5px rgba(57, 55, 63, 0.1)",
  },
  darkXs: {
    value: "0 1px 2px 0 rgba(57, 55, 63, 0.05)",
  },
  darkXxs: {
    value: "0 1px 2px 0 rgba(57, 55, 63, 0.025)",
  },
  innerLeft: {
    value: "inset 9px 0 6px -1px rgb(0 0 0 / 0.02)",
  },
  innerRight: {
    value: "inset -9px 0 6px -1px rgb(0 0 0 / 0.02)",
  },
  lg: {
    value: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
  },
  md: {
    value: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  },
  sm: {
    value: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
  },
  xl: {
    value: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
  },
  xs: {
    value: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  },
  xxs: {
    value: "0 1px 2px 0 rgba(0, 0, 0, 0.025)",
  },
})

export const semanticShadows = defineSemanticTokens.shadows({
  s2xl: {
    value: {
      _dark: "{shadows.dark2xl}",
      base: "{shadows.2xl}",
    },
  },
  sLg: {
    value: {
      _dark: "{shadows.darkLg}",
      base: "{shadows.lg}",
    },
  },
  sMd: {
    value: {
      _dark: "{shadows.darkMd}",
      base: "{shadows.md}",
    },
  },
  sSm: {
    value: {
      _dark: "{shadows.darkSm}",
      base: "{shadows.sm}",
    },
  },
  sXl: {
    value: {
      _dark: "{shadows.darkXl}",
      base: "{shadows.xl}",
    },
  },
  sXs: {
    value: {
      _dark: "{shadows.darkXs}",
      base: "{shadows.xs}",
    },
  },
  sXxs: {
    value: {
      _dark: "{shadows.darkXxs}",
      base: "{shadows.xxs}",
    },
  },
})
