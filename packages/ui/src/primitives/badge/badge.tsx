import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const badgeStyles = cva({
  base: {
    alignItems: "center",
    colorPalette: "brand.primary",
    display: "inline-flex",
    fontWeight: "500",
    justifyContent: "center",
    textAlign: "center",
    transitionDuration: "150ms",
    transitionProperty:
      "color, background-color, border-color, text-decoration-color, fill, stroke",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  defaultVariants: {
    look: "soft",
    size: "sm",
  },
  variants: {
    look: {
      outline: {
        boxShadow: "inset 0 0 0 1px var(--shadow-color)",
        color: "colorPalette.11",
        shadowColor: "colorPalette.8",
      },
      soft: {
        bg: "colorPalette.4",
        color: "colorPalette.11",
      },
      solid: {
        bg: "colorPalette.9",
        color: "color.gray.1",
      },
    },
    size: {
      auto: {},
      lg: {
        fontSize: "2",
        px: "2",
        py: "1",
        rounded: "xl",
      },
      md: {
        fontSize: "1",
        px: "1.5",
        py: "0.5",
        rounded: "lg",
      },
      sm: {
        fontSize: "1",
        px: "1",
        py: "0.5",
        rounded: "lg",
      },
      xs: {
        fontSize: "0.5",
        fontWeight: "500",
        px: "1",
        py: "0.5",
        rounded: "md",
      },
    },
  },
})

const StyledBadge = styled("div", badgeStyles)

type BadgeVariants = RecipeVariantProps<typeof badgeStyles>

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & BadgeVariants & JsxStyleProps

export const Badge = ({ ...props }: BadgeProps) => {
  return <StyledBadge {...props} />
}
