import { cva } from "@danwo/ui/css"
import {
  TableBody,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@danwo/ui/primitives/table"
import type { ComponentProps, CSSProperties, ReactNode, RefObject } from "react"

import { Panel } from "./panel.tsx"

/** The breakpoint below which a column hides. */
type HideBelow = "md" | "lg"

/**
 * One column of a table on a panel. The table lays out by these widths, not by what its cells
 * hold, so the page's rows and its loading skeleton's rows line up to the pixel.
 */
export interface TableColumn {
  readonly key: string
  /** What the header cell says. */
  readonly head: ReactNode
  /** The column's width. The one column without one takes what is left, down to `minW`. */
  readonly w?: string
  /** The narrowest the column without a width gets before the table scrolls sideways. */
  readonly minW?: string
  readonly hideBelow?: HideBelow
  readonly align?: "right"
  /** Anything else the header cell takes, such as its padding or `aria-sort`. */
  readonly headProps?: ComponentProps<typeof TableHead>
}

/** Hides a column's cells below a breakpoint, as a recipe the style extractor can see. */
const hiddenBelow = cva({
  variants: {
    below: {
      md: { display: { base: "none", md: "table-cell" } },
      lg: { display: { base: "none", lg: "table-cell" } },
    },
  },
})

const BREAKPOINTS = ["base", "md", "lg"] as const

/** Whether a column shows at a breakpoint. */
function shownAt(column: TableColumn, at: (typeof BREAKPOINTS)[number]): boolean {
  if (column.hideBelow === "lg") return at === "lg"
  if (column.hideBelow === "md") return at !== "base"

  return true
}

/**
 * How wide the table must be at each breakpoint for its columns to keep their widths, as the
 * custom properties its `minW` reads; narrower than that, it scrolls sideways.
 */
function minWidths(columns: readonly TableColumn[]): CSSProperties {
  return Object.fromEntries(
    BREAKPOINTS.map((at) => [
      `--table-min-${at}`,
      `calc(${columns
        .filter((column) => shownAt(column, at))
        .map((column) => column.w ?? column.minW ?? "10rem")
        .join(" + ")})`,
    ]),
  )
}

/**
 * A table on a panel, laid out by its columns: each one's width set once, on its header cell, so
 * a page's table and its loading skeleton build on the same columns and line up.
 */
export function PanelTable({
  label,
  columns,
  bodyRef,
  after,
  children,
}: {
  readonly label: string
  readonly columns: readonly TableColumn[]
  readonly bodyRef?: RefObject<HTMLTableSectionElement | null>
  /** What sits on the panel under the table, such as a note that nothing matched. */
  readonly after?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Panel px="2" py="1">
      <TableContainer
        aria-label={label}
        tableLayout="fixed"
        minW={{
          base: "var(--table-min-base)",
          md: "var(--table-min-md)",
          lg: "var(--table-min-lg)",
        }}
        style={minWidths(columns)}
      >
        <TableHeader>
          <TableRow _hover={{ bg: "transparent" }}>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={
                  column.hideBelow === undefined
                    ? undefined
                    : hiddenBelow({ below: column.hideBelow })
                }
                color="ink.muted"
                textAlign={column.align ?? "left"}
                style={column.w === undefined ? undefined : { width: column.w }}
                {...column.headProps}
              >
                {column.head}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef}>{children}</TableBody>
      </TableContainer>
      {after}
    </Panel>
  )
}
