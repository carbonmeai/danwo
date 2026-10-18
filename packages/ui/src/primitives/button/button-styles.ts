import { cva } from "@danwo/ui/css"

export const buttonStyle = cva({
  base: {
    _disabled: {
      cursor: "not-allowed",
      opacity: "0.8",
      pointerEvents: "none",
    },

    _hover: {
      _disabled: {
        opacity: "0.8",
      },
    },

    "& span": {
      alignItems: "center",
      display: "flex",
      gap: "1",
    },
    alignItems: "center",
    boxSizing: "border-box",
    colorPalette: "palette.gray",
    cursor: "pointer",
    display: "flex",
    fontWeight: "500",
    gap: "1",
    justifyContent: "center",
    rounded: "xl",
    transition: "border-color 0.2s ease-in-out, text-decoration-color 0.2s ease-in-out",
    userSelect: "none",
    w: "auto",
    whiteSpace: "nowrap",
  },
  defaultVariants: {
    size: "xs",
    variant: "solid",
  },
  variants: {
    size: {
      icon: {
        fontSize: "1",
        h: "1.75rem",
        rounded: "lg",
        w: "1.75rem",
      },
      lg: {
        fontSize: "2",
        h: "2.5rem",
        px: "4",
        rounded: "xl",
      },
      md: {
        fontSize: "2",
        h: "2.25rem",
        px: "4",
        rounded: "lg",
      },
      sm: {
        fontSize: "2",
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
      form: {
        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          border: "focused",
        },
        bg: "transparent",
        border: "subtle",
        fontWeight: "400",
        justifyContent: "space-between",
        w: "100%",
        whiteSpace: "nowrap",
      },
      ghost: {
        _hover: {
          bg: "colorPalette.4",
        },
        bg: "transparent",
        color: "colorPalette.12",
      },
      outline: {
        "& .spinner, & .spinner *": {
          borderTopColor: "colorPalette.11",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          bg: "colorPalette.2",
          opacity: "1",
        },
        bg: "transparent",
        border: "1px solid",
        borderColor: "colorPalette.3",
        color: "colorPalette.12",
        colorPalette: "palette.gray",
        shadow: "sm",
        shadowColor: "colorPalette.4",
      },
      soft: {
        _hover: {
          bg: "colorPalette.4",
        },

        _light: {
          color: "colorPalette.11",
        },

        "& .spinner, & .spinner *": {
          borderTopColor: "colorPalette.11",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          bg: "colorPalette.6",
          color: "colorPalette.12",
          opacity: "1",
        },
        bg: "colorPalette.3",
        borderColor: "colorPalette.2",
        color: "colorPalette.12",
      },
      /**
       * colorPalette.1 rather than colorPalette.contrast: no palette defines a
       * contrast step, so the token resolved to nothing and the label kept the
       * inherited grey on a black button. Step 1 is the inverse of step 9.
       */
      solid: {
        _hover: {
          _disabled: {
            opacity: "0.8",
          },
        },

        "& .spinner, & .spinner *": {
          borderTopColor: "color.gray.1",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          bg: "colorPalette.9",
          color: "colorPalette.1",
          opacity: "1",
        },
        bg: "colorPalette.9",
        color: "colorPalette.1",
        colorPalette: "brand.primary",
      },
      transparent: {
        _hover: {
          bg: "colorPalette.3",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          _hover: {
            bg: "colorPalette.3",
          },
          bg: "colorPalette.3",
          opacity: "1",
        },
        bg: "transparent",
        color: "colorPalette.12",
      },
      underline: {
        _hover: {
          textDecorationColor: "colorPalette.9",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          colorPalette: "brand.primary",
          opacity: "1",
          textDecorationColor: "colorPalette.9",
        },
        bg: "transparent",
        colorPalette: "palette.gray",
        textDecoration: "underline",
        textDecorationColor: "colorPalette.4",
        textUnderlineOffset: "3px",
      },
    },
  },
})
