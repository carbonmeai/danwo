import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const tableHeadStyles = cva({
  base: {
    "&:has([role=checkbox])": {
      pr: "0",
    },
    color: "text.app",
    fontWeight: "medium",
    h: "10",
    px: "2",
    textAlign: "left",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
})

const StyledTableHead = styled("th", tableHeadStyles)

export const TableHead = ({ ...props }: React.ComponentProps<"th"> & JsxStyleProps) => {
  return <StyledTableHead data-slot="table-head" {...props} />
}
