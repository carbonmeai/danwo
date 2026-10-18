import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const cardStyles = cva({
  base: {
    "& > img:first-child": { roundedTop: "2xl" },
    "& > img:last-child": { roundedBottom: "2xl" },
    "&:has([data-slot=card-footer])": { pb: "0" },
    "&:has(> img:first-child)": { pt: "0" },
    bg: "background.popover",
    border: "subtle",
    color: "text.app",
    display: "flex",
    flexDirection: "column",
    fontSize: "2",
    gap: "4",
    overflow: "hidden",
    py: "4",
    rounded: "2xl",
  },
  defaultVariants: { size: "default" },
  variants: {
    size: {
      default: {
        "&:has([data-slot=card-footer])": { pb: "0" },
        gap: "4",
        py: "4",
      },
      sm: { "&:has([data-slot=card-footer])": { pb: "0" }, gap: "3", py: "3" },
    },
  },
})

const StyledCard = styled("div", cardStyles)

type CardVariants = RecipeVariantProps<typeof cardStyles>

export type CardProps = React.ComponentProps<"div"> & CardVariants & JsxStyleProps

export const Card = ({ size, ...props }: CardProps) => {
  return <StyledCard data-size={size ?? "default"} data-slot="card" size={size} {...props} />
}
