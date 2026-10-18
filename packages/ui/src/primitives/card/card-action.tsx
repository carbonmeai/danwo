import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const cardActionStyles = cva({
  base: {
    alignSelf: "start",
    gridColumnStart: "2",
    gridRow: "span 2",
    gridRowStart: "1",
    justifySelf: "end",
  },
})

const StyledCardAction = styled("div", cardActionStyles)

export const CardAction = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledCardAction data-slot="card-action" {...props} />
}
