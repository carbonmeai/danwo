import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const tableBodyStyles = cva({
  base: {
    "& tr:last-child": {
      borderBottom: "none",
    },
  },
})

const StyledTableBody = styled("tbody", tableBodyStyles)

export const TableBody = ({ ...props }: React.ComponentProps<"tbody"> & JsxStyleProps) => {
  return <StyledTableBody data-slot="table-body" {...props} />
}
