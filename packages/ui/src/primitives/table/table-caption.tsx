import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const tableCaptionStyles = cva({
  base: {
    color: "text.muted",
    fontSize: "1",
    mt: "4",
  },
})

const StyledTableCaption = styled("caption", tableCaptionStyles)

export const TableCaption = ({ ...props }: React.ComponentProps<"caption"> & JsxStyleProps) => {
  return <StyledTableCaption data-slot="table-caption" {...props} />
}
