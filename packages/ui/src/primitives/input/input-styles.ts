import { cva } from "@danwo/ui/css"

export const inputStyles = cva({
  base: {
    _dark: {
      _disabled: {
        bg: "palette.gray.3/80",
      },
      bg: "palette.gray.3/30",
    },

    _disabled: {
      bg: "palette.gray.3/50",
      cursor: "not-allowed",
      opacity: "0.5",
      pointerEvents: "none",
    },

    _file: {
      bg: "transparent",
      border: "none",
      color: "text.app",
      display: "inline-flex",
      fontSize: "1",
      fontWeight: "500",
      h: "1.5rem",
    },

    // a borderless field: a darker fill on hover, and a soft grey ring while typing — never a coloured outline
    _hover: { bg: "brand.panel.5" },
    _focus: {
      bg: "brand.panel.3",
      ring: "3px",
      ringColor: { base: "brand.panel.10", _dark: "brand.panel.15" },
    },

    _placeholder: {
      color: "text.placeholder",
    },
    /*
     * explicit error state only (aria-invalid/data-invalid) — never native :invalid,
     * so empty required/email fields aren't red before the user interacts
     */
    "&[aria-invalid=true], &[data-invalid]": {
      _dark: {
        borderColor: "brand.error.9/50",
        ringColor: "brand.error.4",
      },
      borderColor: "brand.error.9",
      ring: "3px",
      ringColor: "brand.error.3",
    },

    /*
     * bg: 'transparent',
     * border: 'subtle',
     */
    color: "text.app",
    fontSize: "1",
    minW: "0",
    outline: "none",
    px: "2.5",
    py: "1",
    rounded: "lg",
    transition: "colors",
    w: "full",
  },
  defaultVariants: {
    size: "xs",
    variant: "subtle",
  },
  variants: {
    size: {
      lg: {
        fontSize: "3",
        h: "2.5rem",
        px: "3.5",
        rounded: "xl",
      },
      md: {
        fontSize: "2",
        h: "2.25rem",
        px: "4",
        rounded: "lg",
      },
      sm: {
        fontSize: "1",
        h: "2rem",
        px: "3",
        rounded: "lg",
      },
      xs: {
        fontSize: "1",
        h: "1.75rem",
        px: "1.5",
        rounded: "lg",
      },
    },
    variant: {
      subtle: {
        bg: "background.muted",
        border: "none",
      },
      outline: {
        bg: "transparent",
        border: "subtle",
      },
    },
  },
})
