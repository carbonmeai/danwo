import { Box, styled } from "@danwo/ui/jsx"
import {
  type ColumnDef as TableColumnDef,
  columnSizingFeature,
  createSortedRowModel,
  flexRender,
  type Row as TableRow,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useRef, useState, type ReactNode } from "react"

import { GRID_FONT_SIZE, GRID_ROW_HEIGHT } from "./constants/sizing"

/**
 * What a grid can do: sort by a header (with the sort functions a column picks by its values) and
 * size a column. Defined once, so the table keeps the same features across renders.
 */
const gridFeatures = tableFeatures({
  columnSizingFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
})

type GridFeatures = typeof gridFeatures

/** A grid column: how to read, show and size one field of a row. */
export type ColumnDef<T extends object> = TableColumnDef<GridFeatures, T>

/** A row of a grid, with the data it was built from. */
export type Row<T extends object> = TableRow<GridFeatures, T>

export type { SortingState }

/** What a data grid needs: its rows, their columns, and optionally how to react to a row. */
export interface DataGridProps<T extends object> {
  readonly data: readonly T[]
  readonly columns: ColumnDef<T>[]
  /** A stable id per row, so selection and keys survive re-sorting; the row index otherwise. */
  readonly getRowId?: (row: T, index: number) => string
  /** Called with the row's data when a row is clicked or activated with Enter. */
  readonly onRowClick?: (row: T) => void
  /** The grid's height; rows beyond it scroll and only the visible ones are rendered. */
  readonly height?: string
  /** The sort to start with; users change it by clicking a sortable header. */
  readonly initialSorting?: SortingState
  /** Shown instead of the body when there are no rows. */
  readonly empty?: ReactNode
  /** Hides the outer border, for grids that sit inside a card. */
  readonly borderless?: boolean
}

const Cell = styled("div", {
  base: {
    alignItems: "center",
    display: "flex",
    fontSize: GRID_FONT_SIZE,
    minW: "0",
    overflow: "hidden",
    px: "3",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
})

const HeaderCell = styled("button", {
  base: {
    alignItems: "center",
    color: "text.secondary",
    cursor: "default",
    display: "flex",
    fontSize: GRID_FONT_SIZE,
    fontWeight: "medium",
    gap: "1",
    minW: "0",
    px: "3",
    textAlign: "start",
    _enabled: { cursor: "pointer", _hover: { color: "text.primary" } },
  },
})

/** The grid template: each column's width, or a share of what is left when it sets none. */
function template<T extends object>(columns: ColumnDef<T>[]): string {
  return columns.map((column) => (column.size ? `${column.size}px` : "minmax(0, 1fr)")).join(" ")
}

/** The arrow after a sorted header's label. */
function sortMark(direction: false | "asc" | "desc"): string {
  if (direction === "asc") return " ↑"
  if (direction === "desc") return " ↓"

  return ""
}

/**
 * A sortable, virtualised grid of rows: only the rows in view are in the DOM, so a run with
 * thousands of steps or trials scrolls as fast as one with ten.
 */
export function DataGrid<T extends object>({
  data,
  columns,
  getRowId,
  onRowClick,
  height = "32rem",
  initialSorting = [],
  empty,
  borderless,
}: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const scroller = useRef<HTMLDivElement>(null)
  const table = useTable({
    features: gridFeatures,
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    ...(getRowId && { getRowId }),
  })
  const rows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => GRID_ROW_HEIGHT,
    overscan: 12,
  })
  const columnsTemplate = template(columns)

  return (
    <GridWrapper borderless={borderless}>
      <Box role="table" aria-rowcount={rows.length} display="flex" flexDirection="column">
        {table.getHeaderGroups().map((group) => (
          <Box
            key={group.id}
            role="row"
            display="grid"
            borderBottomWidth="1px"
            borderColor="border.subtle"
            style={{ gridTemplateColumns: columnsTemplate, height: GRID_ROW_HEIGHT }}
          >
            {group.headers.map((header) => (
              <HeaderCell
                key={header.id}
                role="columnheader"
                type="button"
                disabled={!header.column.getCanSort()}
                onClick={header.column.getToggleSortingHandler()}
                aria-sort={ariaSort(header.column.getIsSorted())}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
                {sortMark(header.column.getIsSorted())}
              </HeaderCell>
            ))}
          </Box>
        ))}
        {rows.length === 0 && empty ? (
          <Box p="6">{empty}</Box>
        ) : (
          <Box ref={scroller} overflowY="auto" style={{ maxHeight: height }}>
            <Box position="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]

                return row ? (
                  <GridRow
                    key={row.id}
                    row={row}
                    top={item.start}
                    template={columnsTemplate}
                    {...(onRowClick && { onRowClick })}
                  />
                ) : null
              })}
            </Box>
          </Box>
        )}
      </Box>
    </GridWrapper>
  )
}

/** How a header's sort state reads to assistive technology. */
function ariaSort(direction: false | "asc" | "desc"): "ascending" | "descending" | "none" {
  if (direction === "asc") return "ascending"
  if (direction === "desc") return "descending"

  return "none"
}

/** One rendered row, placed where the virtualiser puts it. */
function GridRow<T extends object>({
  row,
  top,
  template: columnsTemplate,
  onRowClick,
}: {
  readonly row: Row<T>
  readonly top: number
  readonly template: string
  readonly onRowClick?: (row: T) => void
}) {
  const activate = onRowClick ? () => onRowClick(row.original) : undefined

  return (
    <Box
      role="row"
      display="grid"
      position="absolute"
      left="0"
      right="0"
      borderBottomWidth="1px"
      borderColor="border.subtle"
      cursor={activate ? "pointer" : "default"}
      _hover={activate ? { bg: "background.hover" } : {}}
      tabIndex={activate ? 0 : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter") activate?.()
      }}
      style={{ gridTemplateColumns: columnsTemplate, height: GRID_ROW_HEIGHT, top }}
    >
      {row.getAllCells().map((cell) => (
        <Cell key={cell.id} role="cell">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </Cell>
      ))}
    </Box>
  )
}

/** The frame around a grid: a rounded border unless the grid sits borderless inside another surface. */
export const GridWrapper = ({
  children,
  borderless,
}: {
  readonly children: ReactNode
  readonly borderless?: boolean | undefined
}) => (
  <Box
    bg="background.app"
    borderColor="border.subtle"
    borderWidth={borderless ? "0" : "1px"}
    overflow="hidden"
    rounded="md"
    w="full"
  >
    {children}
  </Box>
)
