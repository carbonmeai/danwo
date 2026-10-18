import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const tableFooterStyles = cva({
  base: {
    "& > tr:last-child": {
      borderBottom: "none",
    },
    bg: "background.muted",
    borderTop: "subtle",
    fontWeight: "medium",
  },
})

const StyledTableFooter = styled("tfoot", tableFooterStyles)

export const TableFooter = ({ ...props }: React.ComponentProps<"tfoot"> & JsxStyleProps) => {
  return <StyledTableFooter data-slot="table-footer" {...props} />
}
