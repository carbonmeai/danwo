import { cva, cx } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const tableRowStyles = cva({
  base: {
    _hover: {
      bg: "background.muted",
    },
    "&[data-state=selected]": {
      bg: "background.muted",
    },
    borderBottom: "subtle",
    p: "0",
    transition: "colors",
  },
})

const StyledTableRow = styled("tr", tableRowStyles)

export const TableRow = ({ className, ...props }: React.ComponentProps<"tr"> & JsxStyleProps) => {
  return <StyledTableRow className={cx(className)} data-slot="table-row" {...props} />
}
