import type { Verdict } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Checkbox } from "@danwo/ui/primitives/checkbox/checkbox"
import { TableCell, TableRow } from "@danwo/ui/primitives/table"
import { Span } from "@danwo/ui/primitives/typography"
import { Link, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"

import { ANY, Choice } from "../../components/choice.tsx"
import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { PanelTable, type TableColumn } from "../../components/panel-table.tsx"
import { DeletedRecording } from "../../components/recordings.tsx"
import {
  ActionsBone,
  BlockBone,
  Bone,
  BoneCell,
  BoneRow,
  lineWidth,
} from "../../components/skeleton.tsx"
import { StatusBadge, VerdictBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { WhoseBadge } from "../../components/whose-badge.tsx"
import { percent } from "../../lib/format.ts"
import { useFilter } from "../../lib/list-keys.ts"
import { VERDICT_CHOICES, verdictParam } from "../../lib/whose.ts"
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

/** Plays a test's latest recording over the page, when one was kept and is still on disk. */
function Watch({ row, keepRuns }: { readonly row: TestRow; readonly keepRuns: number }) {
  if (row.recordingDeleted) return <DeletedRecording keepRuns={keepRuns} />
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
  keepRuns,
}: {
  readonly row: TestRow
  readonly picked: boolean
  readonly onPick: (picked: boolean) => void
  readonly keepRuns: number
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
          <HStack gap="2" flexWrap="wrap">
            <StatusBadge status={row.last.status} />
            {row.last.verdict ? <WhoseBadge verdict={row.last.verdict} /> : null}
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
          <Watch row={row} keepRuns={keepRuns} />
          <RerunTest testId={row.id} compact />
        </HStack>
      </TableCell>
    </TableRow>
  )
}

/** Narrows the tests to those whose latest run failed with one verdict, kept in the address. */
function VerdictChoice({ verdict }: { readonly verdict: Verdict | undefined }) {
  const navigate = useNavigate()

  return (
    <Choice
      label="Whose failure"
      value={verdict ?? ANY}
      options={[[ANY, "Any result"], ...VERDICT_CHOICES]}
      onChange={(picked) =>
        void navigate({
          to: "/tests",
          search: (prev) => ({ ...prev, verdict: verdictParam(picked) }),
          replace: true,
        })
      }
    />
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

/**
 * The tests table's columns, which its rows and its skeleton's rows both fill; `onPick` picks
 * every test shown, and is absent while the tests load.
 */
export function testColumns(
  picked: boolean,
  onPick?: (picked: boolean) => void,
): readonly TableColumn[] {
  return [
    {
      key: "pick",
      w: "2.5rem",
      headProps: { px: "3" },
      head: (
        <Checkbox
          aria-label="Pick every test shown"
          checked={picked}
          disabled={onPick === undefined}
          onCheckedChange={(checked) => onPick?.(checked === true)}
        />
      ),
    },
    { key: "recording", head: <Span srOnly>Recording</Span>, w: "7rem", hideBelow: "md" },
    { key: "test", head: "Test", minW: "14rem" },
    { key: "last", head: "Last run", w: "7rem" },
    { key: "pass", head: "Pass rate", w: "5rem", align: "right", hideBelow: "lg" },
    { key: "matrix", head: "Matrix", w: "10rem", hideBelow: "lg" },
    { key: "actions", head: <Span srOnly>Actions</Span>, w: "5.5rem" },
  ]
}

/** A test's row still loading, its cells those of {@link TestRowLine}. */
export function TestRowSkeleton({ i }: { readonly i: number }) {
  return (
    <BoneRow>
      <BoneCell w="2.5rem" px="3">
        <BlockBone w="4" h="4" rounded="sm" />
      </BoneCell>
      <BoneCell w="7rem" display={{ base: "none", md: "table-cell" }}>
        <BlockBone w="24" h="14" rounded="md" />
      </BoneCell>
      <BoneCell w="full" minW="14rem" whiteSpace="normal">
        <Bone w={lineWidth(i)} />
      </BoneCell>
      <BoneCell>
        <Bone w="4rem" />
        <Bone w="5rem" fontSize="1" mt="1" />
      </BoneCell>
      <BoneCell display={{ base: "none", lg: "table-cell" }}>
        <Bone w="2.5rem" ml="auto" />
      </BoneCell>
      <BoneCell display={{ base: "none", lg: "table-cell" }} bone="7rem" />
      <BoneCell>
        <ActionsBone count={2} />
      </BoneCell>
    </BoneRow>
  )
}

/** The tests shown, in the library's table, picked ones marked. */
function TestsTable({
  shown,
  picked,
  setPicked,
  keepRuns,
}: {
  readonly shown: readonly TestRow[]
  readonly picked: ReadonlySet<string>
  readonly setPicked: (next: ReadonlySet<string>) => void
  readonly keepRuns: number
}) {
  const pick = (id: string, on: boolean) => {
    const next = new Set(picked)

    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  return (
    <PanelTable
      label="Tests"
      layout={testColumns(shown.length > 0 && shown.every((row) => picked.has(row.id)), (on) =>
        setPicked(on ? new Set(shown.map((row) => row.id)) : new Set()),
      )}
    >
      {shown.map((row) => (
        <TestRowLine
          key={row.id}
          row={row}
          picked={picked.has(row.id)}
          onPick={(on) => pick(row.id, on)}
          keepRuns={keepRuns}
        />
      ))}
    </PanelTable>
  )
}

/** What the test library is, under its title. */
export const TESTS_DETAIL =
  "Every test in this project. The play button opens its latest recording; the matrix column says what the fault matrix made of it."

/** The test library's two columns: the files down the side on a wide screen, and the table. */
export function TestsLayout({
  side,
  children,
}: {
  readonly side: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", lg: "15rem minmax(0, 1fr)" }}
      gap="6"
      alignItems="start"
    >
      <Box display={{ base: "none", lg: "block" }} position="sticky" top="16">
        {side}
      </Box>
      {children}
    </Grid>
  )
}

/**
 * The project's test library: its files down the side, its tests in a table with how each did
 * last, how often it passes and what the fault matrix made of it. Pick some and run them, or run
 * the lot; the play button opens a test's latest recording over the page.
 */
export function TestsPage({
  rows,
  keepRuns,
  file,
  verdict,
  query,
}: {
  readonly rows: readonly TestRow[]
  /** How many runs keep their recordings, for tests whose recordings were deleted. */
  readonly keepRuns: number
  readonly file: string | undefined
  /** Only tests whose latest run failed with this verdict. */
  readonly verdict?: Verdict | undefined
  readonly query?: {
    readonly query: string
    readonly onChange: (query: string) => void
  }
}) {
  const inFile = rows.filter(
    (row) =>
      (file === undefined || (row.file ?? "other") === file) &&
      (verdict === undefined || row.last?.verdict?.verdict === verdict),
  )
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
      detail={TESTS_DETAIL}
      actions={
        <>
          <VerdictChoice verdict={verdict} />
          <ListFilter label="Filter tests" placeholder="Filter tests" filter={found} />
          <RunTests testIds={[...picked]} />
        </>
      }
    >
      <LiveRuns />
      <TestsLayout side={<Groups rows={rows} file={file} />}>
        {found.shown.length === 0 ? (
          <Empty title="No tests here" hint="No test here matches the filters." />
        ) : (
          <TestsTable
            shown={found.shown}
            picked={picked}
            setPicked={setPicked}
            keepRuns={keepRuns}
          />
        )}
      </TestsLayout>
    </Page>
  )
}
