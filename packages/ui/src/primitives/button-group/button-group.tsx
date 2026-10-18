import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const buttonGroupStyles = cva({
  base: {
    '& > [data-slot=select-trigger]:not([class*="w-"])': {
      w: "fit-content",
    },
    "& > *": {
      _focusVisible: {
        position: "relative",
        zIndex: 10,
      },
    },
    "& > input": {
      flex: "1",
    },
    "&:has(> [data-slot=button-group])": {
      gap: "2",
    },
    "&:has(select[aria-hidden=true]:last-child) > [data-slot=select-trigger]:last-of-type": {
      roundedRight: "lg",
    },
    alignItems: "stretch",
    display: "flex",
    w: "fit-content",
  },
  defaultVariants: {
    orientation: "horizontal",
  },
  variants: {
    orientation: {
      horizontal: {
        "& > [data-slot]:not(:has(~ [data-slot]))": {
          roundedRight: "lg!",
        },
        "& > *:not(:first-child)": {
          borderLeftWidth: "0",
          roundedLeft: "none",
        },
        "& > *:not(:last-child)": {
          roundedRight: "none",
        },
      },
      vertical: {
        "& > [data-slot]:not(:has(~ [data-slot]))": {
          roundedBottom: "lg!",
        },
        "& > *:not(:first-child)": {
          borderTopWidth: "0",
          roundedTop: "none",
        },
        "& > *:not(:last-child)": {
          roundedBottom: "none",
        },
        flexDirection: "column",
      },
    },
  },
})

const StyledButtonGroup = styled("div", buttonGroupStyles)

export type ButtonGroupVariants = RecipeVariantProps<typeof buttonGroupStyles>

export type ButtonGroupProps = React.ComponentProps<"div"> & ButtonGroupVariants & JsxStyleProps

export const ButtonGroup = ({ orientation = "horizontal", ...props }: ButtonGroupProps) => {
  return (
    <StyledButtonGroup
      data-orientation={orientation}
      data-slot="button-group"
      orientation={orientation}
      role="group"
      {...props}
    />
  )
}
