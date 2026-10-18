import { Box } from "@danwo/ui/jsx"
import type { ReactNode } from "react"

import { GRID_ROW_HEIGHT } from "../data-grid/constants/sizing"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../table"
import { Skeleton } from "./index"

export type TableSkeletonColumn = {
  key: string
  /** omitted for a leading control column, which shows no bar */
  label?: ReactNode
  width?: string | null
  /** a control column holds its width but renders nothing */
  isControl?: boolean
}

export type TableSkeletonProps = {
  columns: TableSkeletonColumn[]
  /** matches the real table so nothing moves when the rows land */
  rowHeight?: string
  /** enough to overflow any realistic viewport; the container clips the rest */
  rows?: number
  minW?: string
}

const DEFAULT_ROWS = 40

/** deterministic, so the bars do not reshuffle on every render */
const BAR_WIDTHS = ["68%", "46%", "82%", "57%", "74%", "39%"]

/**
 * The real header at the real geometry, then skeleton rows beneath it. Rendering
 * a placeholder header instead would move every column when the data arrived,
 * which is the shift this exists to prevent.
 *
 * Row count is fixed rather than measured — the container clips the overflow, so
 * it fills any viewport without a ResizeObserver.
 */
export const TableSkeleton = ({
  columns,
  rowHeight = `${GRID_ROW_HEIGHT}px`,
  rows = DEFAULT_ROWS,
  minW,
}: TableSkeletonProps) => (
  <Box flex="1" h="full" minH="0" overflow="hidden">
    <Table fontSize="1" minW={minW} style={{ tableLayout: "fixed" }} w="full">
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow h={rowHeight}>
          {columns.map((column) => (
            <TableHead key={column.key}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, row) => (
          <TableRow h={rowHeight} key={`skeleton-row-${row}`}>
            {columns.map((column, index) =>
              column.isControl ? (
                <TableCell key={column.key} />
              ) : (
                <TableCell key={column.key}>
                  <Skeleton h="0.6875rem" w={BAR_WIDTHS[(row + index) % BAR_WIDTHS.length]} />
                </TableCell>
              ),
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
)
