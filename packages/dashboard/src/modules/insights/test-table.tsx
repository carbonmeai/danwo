import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { TableCell, TableHead, TableRow } from "@danwo/ui/primitives/table"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import { useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { PanelTable } from "../../components/panel.tsx"
import { Bone, BoneCell, BoneRow, lineWidth, Repeat } from "../../components/skeleton.tsx"
import { StatusBadge, Swatch, VerdictBadge } from "../../components/status-badge.tsx"
import { dollars, duration, percent } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import { type BreakdownSort, sortBreakdown, type TestBreakdown } from "./test-breakdown.ts"

/** Faults named in a row before the rest are counted. */
const FAULTS_SHOWN = 2

/** How the table is sorted, as the page's address holds it. */
export interface TableOrder {
  readonly sort: BreakdownSort
  readonly ascending: boolean
}

/** A column's display, hidden on screens narrower than a breakpoint. */
const HIDDEN_BELOW = {
  md: { base: "none", md: "table-cell" },
  lg: { base: "none", lg: "table-cell" },
  never: undefined,
} as const

/** A column heading that sorts the table by it, and the other way on a second click. */
function SortHead({
  sort,
  sorting,
  label,
  align = "right",
  hideBelow,
}: {
  readonly sort: BreakdownSort
  readonly sorting: TableOrder
  readonly label: string
  readonly align?: "left" | "right"
  /** Hides the column on screens narrower than this. */
  readonly hideBelow?: "md" | "lg"
}) {
  const on = sorting.sort === sort
  const ascending = on && !sorting.ascending

  return (
    <TableHead
      textAlign={align}
      display={HIDDEN_BELOW[hideBelow ?? "never"]}
      aria-sort={on ? (sorting.ascending ? "ascending" : "descending") : "none"}
    >
      <Button asChild variant="ghost" size="xs" color={on ? "ink.strong" : "ink.muted"} mx="-1.5">
        <Link
          to="/insights"
          search={{ sort, ...(ascending && { dir: "asc" }) }}
          replace
          resetScroll={false}
        >
          {label}
          {on ? (
            sorting.ascending ? (
              <Icons.caretUp size={12} />
            ) : (
              <Icons.caretDown size={12} />
            )
          ) : (
            <Icons.caretUpDown size={12} />
          )}
        </Link>
      </Button>
    </TableHead>
  )
}

/** The faults that broke the test under the matrix, the most frequent named. */
function Breaks({ row }: { readonly row: TestBreakdown }) {
  if (row.matrixRuns === 0) return <Span color="ink.faint">not run</Span>
  if (row.breakingFaults.length === 0)
    return <VerdictBadge tone="passed">held every fault</VerdictBadge>

  const rest = row.breakingFaults.length - FAULTS_SHOWN

  return (
    <Stack gap="1" alignItems="flex-start">
      {row.breakingFaults.slice(0, FAULTS_SHOWN).map((fault) => (
        <VerdictBadge
          key={fault.fault}
          tone="failed"
          maxW="20rem"
          title={`${fault.fault}: failed in ${fault.runs} matrix runs`}
        >
          <Ident overflow="hidden" textOverflow="ellipsis">
            {fault.fault}
          </Ident>
        </VerdictBadge>
      ))}
      {rest > 0 ? (
        <Span color="ink.muted" fontSize="1">
          and {rest} more
        </Span>
      ) : null}
    </Stack>
  )
}

/** A rate with a thin bar under it, in the colour of what it measures. */
function Rate({
  value,
  tone,
}: {
  readonly value: number | null
  readonly tone: "passed" | "flaky"
}) {
  return (
    <Stack gap="1" alignItems="flex-end">
      <Span>{percent(value)}</Span>
      <Box w="3.5rem" h="1" rounded="full" bg="surface.track" overflow="hidden" aria-hidden="true">
        <Swatch
          tone={tone}
          display="block"
          h="full"
          rounded="none"
          style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
        />
      </Box>
    </Stack>
  )
}

function BreakdownLine({
  row,
  current,
}: {
  readonly row: TestBreakdown
  readonly current: boolean
}) {
  return (
    <TableRow data-row data-state={current ? "selected" : undefined}>
      <TableCell minW="14rem" px="3" whiteSpace="normal">
        <Stack gap="1">
          <Link to="/tests" search={{ q: row.id }}>
            <Span fontWeight="500" overflowWrap="anywhere">
              {row.id}
            </Span>
          </Link>
          <HStack gap="2">
            <StatusBadge status={row.lastStatus} />
            <Span color="ink.muted" fontSize="1">
              latest run
            </Span>
          </HStack>
        </Stack>
      </TableCell>
      <TableCell textAlign="right" fontVariantNumeric="tabular-nums">
        {row.runs}
        {row.matrixRuns > 0 ? (
          <Span display="block" color="ink.muted" fontSize="1">
            {row.matrixRuns} matrix
          </Span>
        ) : null}
      </TableCell>
      <TableCell textAlign="right" fontVariantNumeric="tabular-nums">
        <Rate value={row.passRate} tone="passed" />
      </TableCell>
      <TableCell textAlign="right" fontVariantNumeric="tabular-nums">
        <Rate value={row.flakeRate} tone="flaky" />
      </TableCell>
      <TableCell textAlign="right" fontVariantNumeric="tabular-nums">
        {row.medianMs === null ? "–" : duration(row.medianMs)}
      </TableCell>
      <TableCell
        textAlign="right"
        fontVariantNumeric="tabular-nums"
        display={{ base: "none", lg: "table-cell" }}
      >
        {dollars(row.costUsd)}
      </TableCell>
      <TableCell display={{ base: "none", md: "table-cell" }} whiteSpace="normal">
        <Breaks row={row} />
      </TableCell>
    </TableRow>
  )
}

/** The table's header row, each figure's heading sorting by it. */
function TestTableHead({ sorting }: { readonly sorting: TableOrder }) {
  return (
    <>
      <TableHead px="3" color="ink.muted">
        Test
      </TableHead>
      <SortHead sort="runs" sorting={sorting} label="Runs" />
      <SortHead sort="pass" sorting={sorting} label="Pass rate" />
      <SortHead sort="flake" sorting={sorting} label="Flake rate" />
      <SortHead sort="time" sorting={sorting} label="Median time" />
      <SortHead sort="spend" sorting={sorting} label="Spend" hideBelow="lg" />
      <SortHead sort="faults" sorting={sorting} label="Breaks under" align="left" hideBelow="md" />
    </>
  )
}

/** Rows enough to fill a tall window; the page scrolls past the rest once they load. */
const SKELETON_ROWS = 8

/** {@link TestTable} while the tests load: the same headings, the rows as bones. */
export function TestTableSkeleton({ sorting }: { readonly sorting: TableOrder }) {
  return (
    <PanelTable label="Tests" head={<TestTableHead sorting={sorting} />}>
      <Repeat count={SKELETON_ROWS}>
        {(i) => (
          <BoneRow key={i}>
            <BoneCell w="full" minW="14rem" px="3" whiteSpace="normal">
              <Bone w={lineWidth(i)} />
              <Bone w="full" display={{ base: "block", md: "none" }} />
              <HStack gap="2" mt="1" minH="5.5">
                <Bone w="7rem" fontSize="1" />
              </HStack>
            </BoneCell>
            <BoneCell>
              <Bone w="1.5rem" ml="auto" />
            </BoneCell>
            <BoneCell>
              <Bone w="3.5rem" ml="auto" />
            </BoneCell>
            <BoneCell>
              <Bone w="3.5rem" ml="auto" />
            </BoneCell>
            <BoneCell>
              <Bone w="3rem" ml="auto" />
            </BoneCell>
            <BoneCell display={{ base: "none", lg: "table-cell" }}>
              <Bone w="2.5rem" ml="auto" />
            </BoneCell>
            <BoneCell display={{ base: "none", md: "table-cell" }} bone="4rem" />
          </BoneRow>
        )}
      </Repeat>
    </PanelTable>
  )
}

/**
 * Every test, one row each, sortable by any figure: how often it ran and passed, how flaky it is,
 * its median time and spend, and the faults that break it under the matrix.
 */
export function TestTable({
  rows,
  sorting,
}: {
  readonly rows: readonly TestBreakdown[]
  readonly sorting: TableOrder
}) {
  const sorted = sortBreakdown(rows, sorting.sort, sorting.ascending)
  const list = useRef<HTMLTableSectionElement>(null)
  const current = useListKeys(list, sorted.length)

  return (
    <PanelTable label="Tests" head={<TestTableHead sorting={sorting} />} bodyRef={list}>
      {sorted.map((row, i) => (
        <BreakdownLine key={row.id} row={row} current={i === current} />
      ))}
    </PanelTable>
  )
}
