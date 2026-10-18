import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const cardTitleStyles = cva({
  base: {
    "[data-size=sm] &": { fontSize: "2" },
    fontSize: "3",
    fontWeight: "medium",
    lineHeight: "snug",
  },
})

const StyledCardTitle = styled("div", cardTitleStyles)

export const CardTitle = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledCardTitle data-slot="card-title" {...props} />
}
