import { Icons } from "@danwo/ui/icons/base"
import { HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { TableCell, TableHead, TableRow } from "@danwo/ui/primitives/table"
import { Span, Text } from "@danwo/ui/primitives/typography"
import { Link, useNavigate } from "@tanstack/react-router"
import { type RefObject, useRef, useState } from "react"

import { Ident } from "../../components/code.tsx"
import { useCopied } from "../../components/copy-link.tsx"
import { PanelTable } from "../../components/panel.tsx"
import { prunedWords } from "../../components/recordings.tsx"
import { copyAddress, RowMenu } from "../../components/row-menu.tsx"
import { Bone, BoneCell, BoneRow, lineWidth } from "../../components/skeleton.tsx"
import { StatusBadge, VerdictStrip } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { WhoseBadge } from "../../components/whose-badge.tsx"
import { dollars, duration } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import { useKnownRuns } from "../run/known-runs.ts"
import { MatrixIcon, TestIcon } from "./run-icons.tsx"
import type { RunRow } from "./runs-data.ts"
import { countLine, sharesOf, verdictOf } from "./runs-values.ts"

/** A run's ⋯ menu: open it, or copy a link to it. */
function RunMenu({ row }: { readonly row: RunRow }) {
  const navigate = useNavigate()
  const [, copy] = useCopied("Link to the run copied")

  return (
    <RowMenu
      label={`Actions for ${row.title}`}
      actions={[
        {
          label: "Open the run",
          icon: <Icons.arrowUpRight size={14} />,
          onSelect: () => void navigate({ to: "/runs/$runId", params: { runId: row.id } }),
        },
        {
          label: "Copy a link to the run",
          icon: <Icons.copyLink size={14} />,
          onSelect: () => copyAddress(`/runs/${encodeURIComponent(row.id)}`, copy),
        },
      ]}
    />
  )
}

function RunLine({
  row,
  current,
  now,
  keepRuns,
}: {
  readonly row: RunRow
  readonly current: boolean
  readonly now: number
  readonly keepRuns: number
}) {
  return (
    <TableRow data-row data-state={current ? "selected" : undefined} position="relative">
      <TableCell w="7.5rem" px="3">
        <Stack gap="1" alignItems="flex-start">
          <StatusBadge status={verdictOf(row)} />
          {row.topVerdict ? (
            <WhoseBadge verdict={{ verdict: row.topVerdict }} detail={row.whose} />
          ) : null}
        </Stack>
      </TableCell>
      <TableCell minW="0" whiteSpace="normal">
        <Stack gap="1">
          <Link to="/runs/$runId" params={{ runId: row.id }}>
            <Span
              fontWeight="500"
              overflowWrap="anywhere"
              css={{ "&::after": { content: '""', position: "absolute", inset: "0" } }}
            >
              {row.title}
            </Span>
          </Link>
          <HStack gap="2.5" color="ink.muted" fontSize="1">
            <VerdictStrip shares={sharesOf(row)} width="4rem" />
            <Span>{countLine(row)}</Span>
            {row.pruned ? (
              <Span color="ink.faint" title={prunedWords(keepRuns)} data-pruned>
                recording deleted
              </Span>
            ) : null}
          </HStack>
        </Stack>
      </TableCell>
      <TableCell w="10rem" color="ink.soft" display={{ base: "none", md: "table-cell" }}>
        <HStack gap="2">
          <Span color="ink.muted" display="inline-flex">
            {row.kind === "matrix" ? <MatrixIcon /> : <TestIcon />}
          </Span>
          <Ident fontSize="1">danwo {row.kind}</Ident>
        </HStack>
      </TableCell>
      <TableCell w="6rem" textAlign="right" fontVariantNumeric="tabular-nums">
        {duration(row.durationMs)}
      </TableCell>
      <TableCell
        w="6rem"
        textAlign="right"
        fontVariantNumeric="tabular-nums"
        display={{ base: "none", lg: "table-cell" }}
      >
        {row.modelCalls > 0 ? dollars(row.costUsd) : "–"}
      </TableCell>
      <TableCell w="9rem" textAlign="right" color="ink.muted">
        <TimeAgo at={row.startedAt} now={now} />
      </TableCell>
      <TableCell w="3rem" textAlign="right">
        <RunMenu row={row} />
      </TableCell>
    </TableRow>
  )
}

/** The runs table's header row. */
export function RunsHead() {
  return (
    <>
      <TableHead px="3" color="ink.muted">
        Result
      </TableHead>
      <TableHead color="ink.muted">What ran</TableHead>
      <TableHead color="ink.muted" display={{ base: "none", md: "table-cell" }}>
        Command
      </TableHead>
      <TableHead color="ink.muted" textAlign="right">
        Time
      </TableHead>
      <TableHead color="ink.muted" textAlign="right" display={{ base: "none", lg: "table-cell" }}>
        Spend
      </TableHead>
      <TableHead color="ink.muted" textAlign="right">
        Started
      </TableHead>
      <TableHead>
        <Span srOnly>Actions</Span>
      </TableHead>
    </>
  )
}

/** A run's row still loading, its cells those of {@link RunLine}. */
export function RunLineSkeleton({ i }: { readonly i: number }) {
  return (
    <BoneRow>
      <BoneCell w="7.5rem" px="3">
        <Bone w="4rem" />
      </BoneCell>
      <BoneCell w="full" minW="0" whiteSpace="normal">
        <Bone w={lineWidth(i)} />
        <Bone w="full" display={{ base: "block", md: "none" }} />
        <Bone w="12rem" fontSize="1" mt="1" />
        <Bone w="6rem" fontSize="1" display={{ base: "block", md: "none" }} />
      </BoneCell>
      <BoneCell w="10rem" display={{ base: "none", md: "table-cell" }} bone="7rem" />
      <BoneCell w="6rem">
        <Bone w="3rem" ml="auto" />
      </BoneCell>
      <BoneCell w="6rem" display={{ base: "none", lg: "table-cell" }}>
        <Bone w="2.5rem" ml="auto" />
      </BoneCell>
      <BoneCell w="9rem">
        <Bone w="5rem" ml="auto" />
      </BoneCell>
      <BoneCell w="3rem" />
    </BoneRow>
  )
}

/** The runs on this page that match the filter, j and k moving through them. */
export function RunsTable({
  shown,
  deferred,
  box,
  keepRuns,
}: {
  readonly shown: readonly RunRow[]
  readonly deferred: string
  readonly box: RefObject<HTMLInputElement | null>
  /** How many runs keep their recordings, for rows whose recordings were deleted. */
  readonly keepRuns: number
}) {
  const list = useRef<HTMLTableSectionElement>(null)
  const current = useListKeys(list, shown.length, box)
  const [now] = useState(() => Date.now())

  useKnownRuns(shown)

  return (
    <PanelTable
      label="Runs"
      head={<RunsHead />}
      bodyRef={list}
      after={
        shown.length === 0 ? (
          <Text px="3" py="6" color="ink.muted" textAlign="center">
            No run on this page matches “{deferred}”.
          </Text>
        ) : null
      }
    >
      {shown.map((row, i) => (
        <RunLine key={row.id} row={row} current={i === current} now={now} keepRuns={keepRuns} />
      ))}
    </PanelTable>
  )
}

/** Links to newer and older pages of runs, when there is more than one. */
export function Pager({ page, pages }: { readonly page: number; readonly pages: number }) {
  if (pages <= 1) return null

  return (
    <HStack justify="flex-end" gap="2" mt="3" fontSize="1" color="ink.muted">
      {page > 0 ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/runs" search={(prev) => ({ ...prev, page: page > 1 ? page - 1 : undefined })}>
            <Icons.caretLeft size={12} />
            Newer
          </Link>
        </Button>
      ) : null}
      <Span>
        Page {page + 1} of {pages}
      </Span>
      {page + 1 < pages ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/runs" search={(prev) => ({ ...prev, page: page + 1 })}>
            Older
            <Icons.caretRight size={12} />
          </Link>
        </Button>
      ) : null}
    </HStack>
  )
}
