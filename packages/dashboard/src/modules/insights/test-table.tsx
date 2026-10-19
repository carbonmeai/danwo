import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import { useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { Badge, StatusBadge } from "../../components/status-badge.tsx"
import { RowPanel, RowTable, Td, Th } from "../../components/table.tsx"
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
    <Th
      textAlign={align}
      display={HIDDEN_BELOW[hideBelow ?? "never"]}
      aria-sort={on ? (sorting.ascending ? "ascending" : "descending") : "none"}
    >
      <Link
        to="/insights"
        search={{ sort, ...(ascending && { dir: "asc" }) }}
        replace
        resetScroll={false}
      >
        <HStack
          as="span"
          gap="1"
          display="inline-flex"
          color={on ? "ink.strong" : undefined}
          _hover={{ color: "ink.strong" }}
        >
          {label}
          {on ? (
            sorting.ascending ? (
              <Icons.caretUp size={12} />
            ) : (
              <Icons.caretDown size={12} />
            )
          ) : null}
        </HStack>
      </Link>
    </Th>
  )
}

/** The faults that broke the test under the matrix, the most frequent named. */
function Breaks({ row }: { readonly row: TestBreakdown }) {
  if (row.matrixRuns === 0) return <styled.span color="ink.faint">not run</styled.span>
  if (row.breakingFaults.length === 0) return <Badge tone="passed">held every fault</Badge>

  const rest = row.breakingFaults.length - FAULTS_SHOWN

  return (
    <Stack gap="1" alignItems="flex-start">
      {row.breakingFaults.slice(0, FAULTS_SHOWN).map((fault) => (
        <Badge
          key={fault.fault}
          tone="failed"
          maxW="20rem"
          title={`${fault.fault}: failed in ${fault.runs} matrix runs`}
        >
          <Ident overflow="hidden" textOverflow="ellipsis">
            {fault.fault}
          </Ident>
        </Badge>
      ))}
      {rest > 0 ? (
        <styled.span color="ink.muted" fontSize="1">
          and {rest} more
        </styled.span>
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
      <span>{percent(value)}</span>
      <Box w="3.5rem" h="1" rounded="full" bg="surface.track" overflow="hidden" aria-hidden="true">
        <Box
          h="full"
          bg={tone === "passed" ? "verdict.passed.solid" : "verdict.flaky.solid"}
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
    <tr data-row data-current={current || undefined}>
      <Td minW="14rem">
        <Stack gap="1">
          <Link to="/tests" search={{ q: row.id }}>
            <styled.span fontWeight="500" overflowWrap="anywhere">
              {row.id}
            </styled.span>
          </Link>
          <HStack gap="2">
            <StatusBadge status={row.lastStatus} />
            <styled.span color="ink.muted" fontSize="1">
              latest run
            </styled.span>
          </HStack>
        </Stack>
      </Td>
      <Td textAlign="right" fontVariantNumeric="tabular-nums">
        {row.runs}
        {row.matrixRuns > 0 ? (
          <styled.span display="block" color="ink.muted" fontSize="1">
            {row.matrixRuns} matrix
          </styled.span>
        ) : null}
      </Td>
      <Td textAlign="right" fontVariantNumeric="tabular-nums">
        <Rate value={row.passRate} tone="passed" />
      </Td>
      <Td textAlign="right" fontVariantNumeric="tabular-nums">
        <Rate value={row.flakeRate} tone="flaky" />
      </Td>
      <Td textAlign="right" fontVariantNumeric="tabular-nums" whiteSpace="nowrap">
        {row.medianMs === null ? "–" : duration(row.medianMs)}
      </Td>
      <Td
        textAlign="right"
        fontVariantNumeric="tabular-nums"
        display={{ base: "none", lg: "table-cell" }}
      >
        {dollars(row.costUsd)}
      </Td>
      <Td display={{ base: "none", md: "table-cell" }}>
        <Breaks row={row} />
      </Td>
    </tr>
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
    <RowPanel overflowX="auto">
      <RowTable aria-label="Tests">
        <thead>
          <tr>
            <Th>Test</Th>
            <SortHead sort="runs" sorting={sorting} label="Runs" />
            <SortHead sort="pass" sorting={sorting} label="Pass rate" />
            <SortHead sort="flake" sorting={sorting} label="Flake rate" />
            <SortHead sort="time" sorting={sorting} label="Median time" />
            <SortHead sort="spend" sorting={sorting} label="Spend" hideBelow="lg" />
            <SortHead
              sort="faults"
              sorting={sorting}
              label="Breaks under"
              align="left"
              hideBelow="md"
            />
          </tr>
        </thead>
        <tbody ref={list}>
          {sorted.map((row, i) => (
            <BreakdownLine key={row.id} row={row} current={i === current} />
          ))}
        </tbody>
      </RowTable>
    </RowPanel>
  )
}
