import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const tableHeaderStyles = cva({
  base: {
    "& tr": {
      borderBottom: "subtle",
    },
  },
})

const StyledTableHeader = styled("thead", tableHeaderStyles)

export const TableHeader = ({ ...props }: React.ComponentProps<"thead"> & JsxStyleProps) => {
  return <StyledTableHeader data-slot="table-header" {...props} />
}
