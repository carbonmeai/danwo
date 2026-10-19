import { Box } from "@danwo/ui/jsx"
import { TableContainer, TableHeader } from "@danwo/ui/primitives/table"
import type { ComponentProps, ReactNode } from "react"

/**
 * The library's table filling its region and scrolling inside it, its header row stuck to the
 * top: for logs and calls that run long, so the pane around them never scrolls as a whole.
 */
export function ScrollTable({
  label,
  head,
  children,
  ...props
}: {
  readonly label: string
  readonly head: ReactNode
  readonly children: ReactNode
} & ComponentProps<typeof Box>) {
  return (
    <Box
      h="full"
      minH="0"
      bg="surface.item"
      rounded="10px"
      overflow="hidden"
      css={{
        "& [data-slot=table-container]": { h: "full", overflow: "auto" },
        "& [data-slot=table-header] th": {
          position: "sticky",
          top: "0",
          zIndex: "1",
          bg: "surface.item",
          boxShadow: "inset 0 -1px 0 {colors.hairline}",
        },
      }}
      {...props}
    >
      <TableContainer aria-label={label}>
        <TableHeader>{head}</TableHeader>
        {children}
      </TableContainer>
    </Box>
  )
}
