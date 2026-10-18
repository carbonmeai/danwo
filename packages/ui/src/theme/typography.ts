import { defineTextStyles, defineTokens } from "@pandacss/dev"

export const fonts = defineTokens.fonts({
  dmSans: { value: "var(--font-dm-sans), sans-serif" },
  ebGaramond: { value: "var(--font-eb-garamond), serif" },
  mono: { value: "var(--font-mono), ui-monospace, monospace" },
  poppins: { value: "var(--font-poppins), sans-serif" },
  sans: {
    value: "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
})

export const fontSizes = defineTokens.fontSizes({
  "0.5": {
    value: "0.5rem",
  },
  /*
   * kbd: {
   * 	value: "0.625rem",
   * },
   */
  "0.25": {
    value: "0.25rem",
  },
  "0.625": {
    value: "0.625rem", //0.625 10px
  },
  "0.688": {
    value: "0.688rem", //0.688 11px
  },
  1: {
    value: "0.75rem", //xs 12px
  },
  /** Between 1 and 2: the body size for breadcrumbs, tabs and list rows. */
  "1.5": {
    value: "0.8125rem", // 13px
  },
  2: {
    value: "0.875rem", //sm 14px
  },
  3: {
    value: "1rem", //base 16px
  },
  4: {
    value: "1.125rem", //lg 18px
  },
  5: {
    value: "1.25rem", //xl 20px
  },
  /** Between 5 and 6: page titles such as an app's name. */
  "5.5": {
    value: "1.375rem", // 22px
  },
  6: {
    value: "1.5rem", //2xl 24px
  },
  7: {
    value: "1.875rem", //3xl 30px
  },
  8: {
    value: "2.25rem", //4xl 36px
  },
  9: {
    value: "3rem", //9xl 48px
  },
  10: {
    value: "3.75rem", //5xl 60px
  },
  11: {
    value: "4.5rem", //6xl 72px
  },
  12: {
    value: "6rem", //7xl 96px
  },
  13: {
    value: "8rem", //8xl 128px
  },
})

export const letterSpacings = defineTokens.letterSpacings({
  1: {
    value: "0.0015625em",
  },
  2: {
    value: "0em",
  },
  3: {
    value: "0em",
  },
  4: {
    value: "-0.0015625em",
  },
  5: {
    value: "-0.003125em",
  },
  6: {
    value: "-0.00390625em",
  },
  7: {
    value: "-0.0046875em",
  },
  8: {
    value: "-0.00625em",
  },
  9: {
    value: "-0.015625em",
  },
})

export const lineHeights = defineTokens.lineHeights({
  1: {
    value: "1rem",
  },
  2: {
    value: "1.25rem",
  },
  3: {
    value: "1.5rem",
  },
  4: {
    value: "1.625rem",
  },
  5: {
    value: "1.75rem",
  },
  6: {
    value: "1.875rem",
  },
  7: {
    value: "2.25rem",
  },
  8: {
    value: "2.5rem",
  },
  9: {
    value: "3.75rem",
  },
})

export const fontWeights = defineTokens.fontWeights({
  100: { value: "100" },
  200: { value: "200" },
  300: { value: "300" },
  400: { value: "400" },
  500: { value: "500" },
  600: { value: "600" },
  700: { value: "700" },
  800: { value: "800" },
  900: { value: "900" },
  black: { value: "900" },
  bold: { value: "700" },
  extrabold: { value: "800" },
  extralight: { value: "200" },
  light: { value: "300" },
  medium: { value: "500" },
  normal: { value: "400" },
  semibold: { value: "600" },
  thin: { value: "100" },
})

export const textStyles = defineTextStyles({
  body: {
    value: {
      fontSize: fontSizes[3].value,
      fontWeight: fontWeights[400].value,
      letterSpacing: letterSpacings[2].value,
      lineHeight: lineHeights[5].value,
    },
  },
  label: {
    value: {
      fontSize: fontSizes[1].value,
      fontWeight: fontWeights[500].value,
      letterSpacing: letterSpacings[2].value,
      lineHeight: lineHeights[2].value,
    },
  },
  modalTitle: {
    value: {
      fontSize: fontSizes[2].value,
      fontWeight: fontWeights[500].value,
      letterSpacing: letterSpacings[2].value,
      lineHeight: lineHeights[2].value,
    },
  },
  sm: {
    value: {
      fontSize: fontSizes[1].value,
      letterSpacing: letterSpacings[1].value,
      lineHeight: lineHeights[1].value,
    },
  },
})
