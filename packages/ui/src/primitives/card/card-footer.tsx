import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const cardFooterStyles = cva({
  base: {
    "[data-size=sm] &": { p: "3" },
    alignItems: "center",
    bg: "background.muted",
    borderTop: "subtle",
    display: "flex",
    p: "4",
    roundedBottom: "2xl",
  },
})

const StyledCardFooter = styled("div", cardFooterStyles)

export const CardFooter = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledCardFooter data-slot="card-footer" {...props} />
}
