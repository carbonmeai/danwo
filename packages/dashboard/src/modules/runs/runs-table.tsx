import { HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import { type RefObject, useRef, useState } from "react"

import { Ident } from "../../components/code.tsx"
import { StatusBadge, VerdictStrip } from "../../components/status-badge.tsx"
import { RowPanel, RowTable, Td, Th } from "../../components/table.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { dollars, duration } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import { MatrixIcon, TestIcon } from "./run-icons.tsx"
import type { RunRow } from "./runs-data.ts"
import { countLine, sharesOf, verdictOf } from "./runs-values.ts"

function RunLine({
  row,
  current,
  now,
}: {
  readonly row: RunRow
  readonly current: boolean
  readonly now: number
}) {
  return (
    <styled.tr data-row data-current={current || undefined} position="relative">
      <Td w="7.5rem">
        <StatusBadge status={verdictOf(row)} />
      </Td>
      <Td minW="0">
        <Stack gap="1">
          <Link to="/runs/$runId" params={{ runId: row.id }}>
            <styled.span
              fontWeight="500"
              overflowWrap="anywhere"
              css={{ "&::after": { content: '""', position: "absolute", inset: "0" } }}
            >
              {row.title}
            </styled.span>
          </Link>
          <HStack gap="2.5" color="ink.muted" fontSize="1">
            <VerdictStrip shares={sharesOf(row)} width="4rem" />
            <span>{countLine(row)}</span>
          </HStack>
        </Stack>
      </Td>
      <Td
        w="10rem"
        color="ink.soft"
        whiteSpace="nowrap"
        display={{ base: "none", md: "table-cell" }}
      >
        <HStack gap="2">
          <styled.span color="ink.muted" display="inline-flex">
            {row.kind === "matrix" ? <MatrixIcon /> : <TestIcon />}
          </styled.span>
          <Ident fontSize="1">danwo {row.kind}</Ident>
        </HStack>
      </Td>
      <Td w="6rem" textAlign="right" fontVariantNumeric="tabular-nums" whiteSpace="nowrap">
        {duration(row.durationMs)}
      </Td>
      <Td
        w="6rem"
        textAlign="right"
        fontVariantNumeric="tabular-nums"
        display={{ base: "none", lg: "table-cell" }}
      >
        {row.modelCalls > 0 ? dollars(row.costUsd) : "–"}
      </Td>
      <Td w="9rem" textAlign="right" color="ink.muted" whiteSpace="nowrap">
        <TimeAgo at={row.startedAt} now={now} />
      </Td>
    </styled.tr>
  )
}

/** The runs on this page that match the filter, j and k moving through them. */
export function RunsTable({
  shown,
  deferred,
  box,
}: {
  readonly shown: readonly RunRow[]
  readonly deferred: string
  readonly box: RefObject<HTMLInputElement | null>
}) {
  const list = useRef<HTMLTableSectionElement>(null)
  const current = useListKeys(list, shown.length, box)
  const [now] = useState(() => Date.now())

  return (
    <RowPanel overflowX="auto">
      <RowTable>
        <thead>
          <tr>
            <Th>Result</Th>
            <Th>What ran</Th>
            <Th display={{ base: "none", md: "table-cell" }}>Command</Th>
            <Th textAlign="right">Time</Th>
            <Th textAlign="right" display={{ base: "none", lg: "table-cell" }}>
              Spend
            </Th>
            <Th textAlign="right">Started</Th>
          </tr>
        </thead>
        <tbody ref={list}>
          {shown.map((row, i) => (
            <RunLine key={row.id} row={row} current={i === current} now={now} />
          ))}
        </tbody>
      </RowTable>
      {shown.length === 0 ? (
        <styled.p px="3" py="6" color="ink.muted" textAlign="center">
          No run on this page matches “{deferred}”.
        </styled.p>
      ) : null}
    </RowPanel>
  )
}

/** Links to newer and older pages of runs, when there is more than one. */
export function Pager({ page, pages }: { readonly page: number; readonly pages: number }) {
  if (pages <= 1) return null

  return (
    <HStack
      justify="flex-end"
      gap="4"
      mt="3"
      fontSize="1"
      color="ink.muted"
      css={{ "& a": { color: "ink.soft", _hover: { color: "ink.strong" } } }}
    >
      {page > 0 ? (
        <Link to="/" search={page > 1 ? { page: page - 1 } : {}}>
          Newer
        </Link>
      ) : null}
      <span>
        Page {page + 1} of {pages}
      </span>
      {page + 1 < pages ? (
        <Link to="/" search={{ page: page + 1 }}>
          Older
        </Link>
      ) : null}
    </HStack>
  )
}
