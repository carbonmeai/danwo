import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { Ident } from "../../components/code.tsx"
import { ListFilter, SegmentTrack, segment } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Badge, StatusBadge } from "../../components/status-badge.tsx"
import { Row, RowList, RowPanel } from "../../components/table.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { percent } from "../../lib/format.ts"
import { useFilter } from "../../lib/list-keys.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { RerunTest, RunMatrix } from "../live/run-actions.tsx"
import { TestThumb } from "./test-thumb.tsx"
import {
  FILTER_WORDS,
  TEST_FILTERS,
  type TestFilter,
  inFilter,
  matrixWords,
  testText,
} from "./test-values.ts"
import type { MatrixVerdict, TestRow } from "./tests-data.ts"

/** What the matrix made of the test, as a chip that opens that matrix run. */
function MatrixChip({ verdict }: { readonly verdict: MatrixVerdict }) {
  if (verdict.kind === "none")
    return (
      <styled.span color="ink.faint" fontSize="1">
        {matrixWords(verdict)}
      </styled.span>
    )

  return (
    <Link to="/runs/$runId" params={{ runId: verdict.runId }} title="Open the latest matrix run">
      <Badge tone={verdict.kind === "held" ? "passed" : "failed"} maxW="18rem">
        <styled.span overflow="hidden" textOverflow="ellipsis">
          {matrixWords(verdict)}
        </styled.span>
      </Badge>
    </Link>
  )
}

/** One test: its picture, name and file, how it did last, its pass rate, the matrix, and actions. */
function TestLine({ row }: { readonly row: TestRow }) {
  return (
    <Row
      data-row
      display="flex"
      alignItems="center"
      gap="4"
      flexWrap={{ base: "wrap", md: "nowrap" }}
    >
      <Link to="/tests/$testId" params={{ testId: row.id }} aria-label={`Open ${row.id}`}>
        <TestThumb thumb={row.thumb} />
      </Link>
      <Stack gap="1" flex="1" minW="12rem">
        <Link to="/tests/$testId" params={{ testId: row.id }}>
          <styled.span fontWeight="500" overflowWrap="anywhere">
            {row.id}
          </styled.span>
        </Link>
        <HStack gap="2" color="ink.muted" fontSize="1" flexWrap="wrap">
          {row.last ? (
            <>
              <StatusBadge status={row.last.status} />
              <span>
                <TimeAgo at={row.last.at} />
              </span>
            </>
          ) : (
            <span>Never run</span>
          )}
        </HStack>
      </Stack>
      <Stack gap="0.5" w="7rem" flexShrink="0">
        <styled.span fontSize="1" color="ink.muted">
          Pass rate
        </styled.span>
        <span>
          {percent(row.passRate)}
          <styled.span color="ink.muted" fontSize="1" ml="1.5">
            {row.runs} {row.runs === 1 ? "run" : "runs"}
          </styled.span>
        </span>
      </Stack>
      <Box w={{ base: "auto", md: "16rem" }} flexShrink="0" minW="0">
        <MatrixChip verdict={row.matrix} />
      </Box>
      <HStack gap="1" flexShrink="0" ml={{ base: "0", md: "auto" }}>
        <RerunTest testId={row.id} />
        {row.matrix.kind === "none" ? <RunMatrix testId={row.id} /> : null}
      </HStack>
    </Row>
  )
}

/** The tabs over the list: every test, or only those failing, flaky or broken by a fault. */
function FilterTabs({
  filter,
  rows,
}: {
  readonly filter: TestFilter
  readonly rows: readonly TestRow[]
}) {
  return (
    <SegmentTrack role="tablist" aria-label="Which tests">
      {TEST_FILTERS.map((tab) => (
        <Link
          key={tab}
          to="/"
          search={(prev) => ({ ...prev, filter: tab === "all" ? undefined : tab })}
          className={segment}
          role="tab"
          aria-selected={tab === filter}
          data-on={tab === filter || undefined}
          replace
        >
          {FILTER_WORDS[tab]}
          <styled.span color="ink.faint" ml="1.5">
            {rows.filter((row) => inFilter(row, tab)).length}
          </styled.span>
        </Link>
      ))}
    </SegmentTrack>
  )
}

/**
 * The project's tests, the dashboard's home: each with how it did last, how often it passes and
 * what the fault matrix made of it. A test opens on its own page, with its recording at the top.
 */
export function TestsPage({
  rows,
  filter,
  query,
}: {
  readonly rows: readonly TestRow[]
  readonly filter: TestFilter
  readonly query?: { readonly query: string; readonly onChange: (query: string) => void }
}) {
  const tabbed = rows.filter((row) => inFilter(row, filter))
  const found = useFilter(tabbed, testText, query)

  if (rows.length === 0)
    return (
      <Page crumbs={["Tests"]} title="Tests">
        <LiveRuns />
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
      detail={
        <>
          Every test in this project. Open one to watch its latest recording, step by step, with
          what it caused behind the app. <Ident>danwo matrix</Ident> replays a test once per fault
          its providers could throw; the matrix column says what it made of each.
        </>
      }
      actions={<ListFilter label="Filter tests" placeholder="Filter tests" filter={found} />}
    >
      <LiveRuns />
      <Stack gap="3">
        <FilterTabs filter={filter} rows={rows} />
        {found.shown.length === 0 ? (
          <Empty title="No tests here" hint="No test matches this tab and filter." />
        ) : (
          <RowPanel pt="1.5">
            <RowList aria-label="Tests">
              {found.shown.map((row) => (
                <TestLine key={row.id} row={row} />
              ))}
            </RowList>
          </RowPanel>
        )}
      </Stack>
    </Page>
  )
}
