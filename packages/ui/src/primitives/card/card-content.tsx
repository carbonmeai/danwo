import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const cardContentStyles = cva({
  base: {
    "[data-size=sm] &": { px: "3" },
    px: "4",
  },
})

const StyledCardContent = styled("div", cardContentStyles)

export const CardContent = ({ ...props }: React.ComponentProps<"div"> & JsxStyleProps) => {
  return <StyledCardContent data-slot="card-content" {...props} />
}
