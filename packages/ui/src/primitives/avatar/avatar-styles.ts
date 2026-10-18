import { cva } from "@danwo/ui/css"

export const avatarRootStyle = cva({
  base: {
    display: "flex",
    flexShrink: "0",
    overflow: "hidden",
    position: "relative",
    rounded: "full",
  },
  defaultVariants: {
    radius: "md",
    size: 1,
    variants: "soft",
  },
  variants: {
    radius: {
      full: {
        rounded: "full",
      },
      lg: {
        rounded: "lg",
      },
      md: {
        rounded: "md",
      },
      none: {
        rounded: "none",
      },
      sm: {
        rounded: "sm",
      },
    },
    size: {
      "0.5": {
        fontSize: "small",
        height: "1rem", // 16px
        letterSpacing: "1",
        lineHeight: "1",
        width: "1rem", // 16px
      },
      1: {
        fontSize: "1",
        height: "1.5rem", // 24px
        letterSpacing: "1",
        lineHeight: "1",
        width: "1.5rem", // 24px
      },
      2: {
        fontSize: "2",
        height: "2rem", // 28px
        letterSpacing: "2",
        lineHeight: "2",
        width: "2rem", // 28px
      },
      3: {
        fontSize: "3",
        height: "2.5rem",
        letterSpacing: "3",
        lineHeight: "3",
        width: "2.5rem",
      },
      4: {
        fontSize: "4",
        height: "3rem",
        letterSpacing: "4",
        lineHeight: "4",
        width: "3rem",
      },
      5: {
        fontSize: "5",
        height: "4rem",
        letterSpacing: "5",
        lineHeight: "5",
        width: "4rem",
      },
      6: {
        fontSize: "6",
        height: "5rem",
        letterSpacing: "6",
        lineHeight: "6",
        width: "5rem",
      },
      7: {
        fontSize: "7",
        height: "6rem",
        letterSpacing: "7",
        lineHeight: "7",
        width: "6rem",
      },
      8: {
        fontSize: "8",
        height: "8rem",
        letterSpacing: "8",
        lineHeight: "8",
        width: "8rem",
      },
      9: {
        fontSize: "9",
        height: "6.25rem",
        letterSpacing: "9",
        lineHeight: "9",
        width: "6.25rem",
      },
    },
    variants: {
      soft: {
        _hover: {
          bg: "colorPalette.4",
        },
        bg: "colorPalette.3",
        color: "colorPalette.11",
        colorPalette: "brand.primary",
      },
      solid: {
        "& *": {
          borderColor: "color.gray.1",
          color: "color.gray.1",
        },
        bg: "colorPalette.9",
        color: { base: "white", _dark: "background.app" },
        colorPalette: "brand.primary",
      },
    },
  },
})
