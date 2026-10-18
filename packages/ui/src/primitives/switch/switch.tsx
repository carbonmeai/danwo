import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Switch as SwitchPrimitives } from "radix-ui"
import type * as React from "react"

const rootStyles = cva({
  base: {
    _disabled: {
      cursor: "not-allowed",
      opacity: "0.5",
    },

    _focusVisible: {
      border: "focused",
    },

    "&[data-state=checked]": {
      bg: "brand.primary.9",
    },

    "&[data-state=unchecked]": {
      bg: "background.muted",
    },
    alignItems: "center",
    border: "subtle",
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: "0",
    rounded: "99999px",
    transitionDuration: "300ms",
    transitionProperty:
      "color, background-color, border-color, text-decoration-color, fill, stroke",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  defaultVariants: {
    size: "sm",
  },
  variants: {
    size: {
      md: {
        h: "1.5rem",
        w: "2.75rem",
      },
      sm: {
        h: "1.25rem",
        w: "2.25rem",
      },
      xs: {
        h: "1rem",
        w: "1.75rem",
      },
    },
  },
})

const thumbStyles = cva({
  base: {
    bg: "white",
    /*
     * The checked track is the primary colour, which turns white in dark mode; the thumb takes the page colour there
     * so it stays visible, mirroring the white thumb on the dark track in light mode.
     */
    _dark: {
      "&[data-state=checked]": { bg: "background.app" },
    },
    display: "block",
    pointerEvents: "none",
    rounded: "50%",
    transitionDuration: "300ms",
    transitionProperty: "transform",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  defaultVariants: {
    size: "sm",
  },
  variants: {
    size: {
      md: {
        "&[data-state=checked]": {
          transform: "translateX(1.313rem)",
        },

        "&[data-state=unchecked]": {
          transform: "translateX(0.125)",
        },
        h: "1.25rem",
        w: "1.25rem",
      },
      sm: {
        "&[data-state=checked]": {
          transform: "translateX(1.063rem)",
        },

        "&[data-state=unchecked]": {
          transform: "translateX(0.125)",
        },
        h: "1rem",
        w: "1rem",
      },
      xs: {
        "&[data-state=checked]": {
          transform: "translateX(0.813rem)",
        },

        "&[data-state=unchecked]": {
          transform: "translateX(0.125)",
        },
        h: "0.75rem",
        w: "0.75rem",
      },
    },
  },
})

const SwitchRoot = styled(SwitchPrimitives.Root, rootStyles)

const SwitchThumb = styled(SwitchPrimitives.Thumb, thumbStyles)

type SwitchVariants = RecipeVariantProps<typeof rootStyles>

export const Switch = ({
  size,
  ...props
}: React.ComponentProps<typeof SwitchPrimitives.Root> & JsxStyleProps & SwitchVariants) => {
  return (
    <SwitchRoot size={size} {...props}>
      <SwitchThumb size={size} />
    </SwitchRoot>
  )
}
