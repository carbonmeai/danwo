import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Checkbox } from "@danwo/ui/primitives/checkbox/checkbox"
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@danwo/ui/primitives/table"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Panel } from "../../components/panel.tsx"
import { StatusBadge, VerdictBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { percent } from "../../lib/format.ts"
import { useFilter } from "../../lib/list-keys.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { RerunTest, RunTests } from "../live/run-actions.tsx"
import type { MatrixVerdict } from "./matrix-verdict.ts"
import { TestThumb } from "./test-thumb.tsx"
import { matrixWords, testText } from "./test-values.ts"
import type { TestRow } from "./tests-data.ts"

/** What the matrix made of the test, as a chip that opens that matrix run. */
function MatrixChip({ verdict }: { readonly verdict: MatrixVerdict }) {
  if (verdict.kind === "none")
    return (
      <Span color="ink.faint" fontSize="1">
        {matrixWords(verdict)}
      </Span>
    )

  return (
    <Link to="/runs/$runId" params={{ runId: verdict.runId }} title="Open the latest matrix run">
      <VerdictBadge tone={verdict.kind === "held" ? "passed" : "failed"} maxW="16rem">
        <Span overflow="hidden" textOverflow="ellipsis">
          {matrixWords(verdict)}
        </Span>
      </VerdictBadge>
    </Link>
  )
}

/** A test's name without its file. */
function nameOf(row: TestRow): string {
  return row.id.split(" › ").slice(1).join(" › ") || row.id
}

/** Plays a test's latest recording over the page, when one was kept. */
function Watch({ row }: { readonly row: TestRow }) {
  if (row.thumb === undefined) return null

  return (
    <Button asChild variant="ghost" size="icon" tooltipChildren="Watch its latest recording">
      <Link
        to="."
        search={(prev) => ({ ...prev, open: row.thumb?.dir })}
        resetScroll={false}
        aria-label={`Watch ${nameOf(row)}`}
      >
        <Icons.play size={14} />
      </Link>
    </Button>
  )
}

/** One test as a table row: picked or not, its picture, name, last run, pass rate and matrix. */
function TestRowLine({
  row,
  picked,
  onPick,
}: {
  readonly row: TestRow
  readonly picked: boolean
  readonly onPick: (picked: boolean) => void
}) {
  return (
    <TableRow data-row data-state={picked ? "selected" : undefined}>
      <TableCell w="2.5rem" px="3">
        <Checkbox
          checked={picked}
          aria-label={`Pick ${row.id}`}
          onCheckedChange={(checked) => onPick(checked === true)}
        />
      </TableCell>
      <TableCell w="7rem" display={{ base: "none", md: "table-cell" }}>
        <TestThumb thumb={row.thumb} />
      </TableCell>
      <TableCell minW="14rem" whiteSpace="normal">
        <Span fontWeight="500" overflowWrap="anywhere">
          {nameOf(row)}
        </Span>
      </TableCell>
      <TableCell>
        {row.last ? (
          <HStack gap="2">
            <StatusBadge status={row.last.status} />
            <Span color="ink.muted" fontSize="1">
              <TimeAgo at={row.last.at} />
            </Span>
          </HStack>
        ) : (
          <Span color="ink.faint">never run</Span>
        )}
      </TableCell>
      <TableCell
        textAlign="right"
        fontVariantNumeric="tabular-nums"
        display={{ base: "none", lg: "table-cell" }}
      >
        {percent(row.passRate)}
      </TableCell>
      <TableCell display={{ base: "none", lg: "table-cell" }}>
        <MatrixChip verdict={row.matrix} />
      </TableCell>
      <TableCell w="5.5rem">
        <HStack gap="0.5" justify="flex-end">
          <Watch row={row} />
          <RerunTest testId={row.id} compact />
        </HStack>
      </TableCell>
    </TableRow>
  )
}

/** One file in the side list: its name and how many tests it holds. */
function GroupLink({
  to,
  label,
  count,
  on,
}: {
  readonly to: string | undefined
  readonly label: string
  readonly count: number
  readonly on: boolean
}) {
  return (
    <Button
      asChild
      variant={on ? "soft" : "ghost"}
      size="sm"
      justifyContent="space-between"
      w="full"
      fontWeight={on ? "500" : "400"}
    >
      <Link
        to="/tests"
        search={(prev) => ({ ...prev, file: to })}
        aria-current={on ? "page" : undefined}
        replace
      >
        <Span overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={label}>
          {label}
        </Span>
        <Span color="ink.faint" fontSize="1">
          {count}
        </Span>
      </Link>
    </Button>
  )
}

/** The tests' files down the side: every test, or only one file's. */
function Groups({
  rows,
  file,
}: {
  readonly rows: readonly TestRow[]
  readonly file: string | undefined
}) {
  const files = [...new Set(rows.map((row) => row.file ?? "other"))].toSorted()

  return (
    <Stack as="nav" aria-label="Test files" gap="0.5">
      <GroupLink to={undefined} label="All tests" count={rows.length} on={file === undefined} />
      <Span color="ink.muted" fontSize="1" fontWeight="500" px="2.5" pt="3" pb="1">
        Files
      </Span>
      {files.map((each) => (
        <GroupLink
          key={each}
          to={each}
          label={each.replace(/^tests\//, "")}
          count={rows.filter((row) => (row.file ?? "other") === each).length}
          on={file === each}
        />
      ))}
    </Stack>
  )
}

/** The tests shown, in the library's table, picked ones marked. */
function TestsTable({
  shown,
  picked,
  setPicked,
}: {
  readonly shown: readonly TestRow[]
  readonly picked: ReadonlySet<string>
  readonly setPicked: (next: ReadonlySet<string>) => void
}) {
  const pick = (id: string, on: boolean) => {
    const next = new Set(picked)

    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  return (
    <Panel px="2" py="1">
      <TableContainer aria-label="Tests">
        <TableHeader>
          <TableRow _hover={{ bg: "transparent" }}>
            <TableHead px="3">
              <Checkbox
                aria-label="Pick every test shown"
                checked={shown.length > 0 && shown.every((row) => picked.has(row.id))}
                onCheckedChange={(checked) =>
                  setPicked(checked === true ? new Set(shown.map((row) => row.id)) : new Set())
                }
              />
            </TableHead>
            <TableHead display={{ base: "none", md: "table-cell" }}>
              <Span srOnly>Recording</Span>
            </TableHead>
            <TableHead color="ink.muted">Test</TableHead>
            <TableHead color="ink.muted">Last run</TableHead>
            <TableHead
              color="ink.muted"
              textAlign="right"
              display={{ base: "none", lg: "table-cell" }}
            >
              Pass rate
            </TableHead>
            <TableHead color="ink.muted" display={{ base: "none", lg: "table-cell" }}>
              Matrix
            </TableHead>
            <TableHead>
              <Span srOnly>Actions</Span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TestRowLine
              key={row.id}
              row={row}
              picked={picked.has(row.id)}
              onPick={(on) => pick(row.id, on)}
            />
          ))}
        </TableBody>
      </TableContainer>
    </Panel>
  )
}

/**
 * The project's test library: its files down the side, its tests in a table with how each did
 * last, how often it passes and what the fault matrix made of it. Pick some and run them, or run
 * the lot; the play button opens a test's latest recording over the page.
 */
export function TestsPage({
  rows,
  file,
  query,
}: {
  readonly rows: readonly TestRow[]
  readonly file: string | undefined
  readonly query?: { readonly query: string; readonly onChange: (query: string) => void }
}) {
  const inFile = file === undefined ? rows : rows.filter((row) => (row.file ?? "other") === file)
  const found = useFilter(inFile, testText, query)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  if (rows.length === 0)
    return (
      <Page crumbs={["Tests"]} title="Tests">
        <Empty
          title="No tests found"
          hint="danwo lists the tests in this project here once it can find them, or once they have run. Set a project up with danwo init."
          command="danwo test"
        />
      </Page>
    )

  return (
    <Page
      crumbs={["Tests"]}
      title="Tests"
      detail="Every test in this project. The play button opens its latest recording; the matrix column says what the fault matrix made of it."
      actions={
        <>
          <ListFilter label="Filter tests" placeholder="Filter tests" filter={found} />
          <RunTests testIds={[...picked]} />
        </>
      }
    >
      <LiveRuns />
      <Grid
        gridTemplateColumns={{ base: "1fr", lg: "15rem minmax(0, 1fr)" }}
        gap="6"
        alignItems="start"
      >
        <Box display={{ base: "none", lg: "block" }} position="sticky" top="16">
          <Groups rows={rows} file={file} />
        </Box>
        {found.shown.length === 0 ? (
          <Empty title="No tests here" hint="No test in this file matches the filter." />
        ) : (
          <TestsTable shown={found.shown} picked={picked} setPicked={setPicked} />
        )}
      </Grid>
    </Page>
  )
}
