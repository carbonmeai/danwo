import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const cardDescriptionStyles = cva({
  base: {
    color: "text.muted",
    fontSize: "2",
  },
})

const StyledCardDescription = styled("div", cardDescriptionStyles)

export const CardDescription = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledCardDescription data-slot="card-description" {...props} />
}
