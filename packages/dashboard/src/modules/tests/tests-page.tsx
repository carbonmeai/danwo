import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Badge, StatusBadge } from "../../components/status-badge.tsx"
import { RowPanel, RowTable, Td, Th } from "../../components/table.tsx"
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
      <styled.span color="ink.faint" fontSize="1">
        {matrixWords(verdict)}
      </styled.span>
    )

  return (
    <Link to="/runs/$runId" params={{ runId: verdict.runId }} title="Open the latest matrix run">
      <Badge tone={verdict.kind === "held" ? "passed" : "failed"} maxW="16rem">
        <styled.span overflow="hidden" textOverflow="ellipsis">
          {matrixWords(verdict)}
        </styled.span>
      </Badge>
    </Link>
  )
}

/** A test's name: opens its latest recording over the page when one was kept. */
function TestName({ row }: { readonly row: TestRow }) {
  const name = (
    <styled.span fontWeight="500" overflowWrap="anywhere">
      {row.id.split(" › ").slice(1).join(" › ") || row.id}
    </styled.span>
  )

  if (row.thumb === undefined) return name

  return (
    <Link
      to="."
      search={(prev) => ({ ...prev, open: row.thumb?.dir })}
      resetScroll={false}
      title="Watch its latest recording"
    >
      {name}
    </Link>
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
    <tr data-row data-picked={picked || undefined}>
      <Td w="2.5rem">
        <input
          type="checkbox"
          checked={picked}
          aria-label={`Pick ${row.id}`}
          onChange={(event) => onPick(event.target.checked)}
        />
      </Td>
      <Td w="7rem" display={{ base: "none", md: "table-cell" }}>
        <TestThumb thumb={row.thumb} />
      </Td>
      <Td minW="14rem">
        <TestName row={row} />
      </Td>
      <Td whiteSpace="nowrap">
        {row.last ? (
          <HStack gap="2">
            <StatusBadge status={row.last.status} />
            <styled.span color="ink.muted" fontSize="1">
              <TimeAgo at={row.last.at} />
            </styled.span>
          </HStack>
        ) : (
          <styled.span color="ink.faint">never run</styled.span>
        )}
      </Td>
      <Td
        textAlign="right"
        fontVariantNumeric="tabular-nums"
        display={{ base: "none", lg: "table-cell" }}
      >
        {percent(row.passRate)}
      </Td>
      <Td display={{ base: "none", lg: "table-cell" }}>
        <MatrixChip verdict={row.matrix} />
      </Td>
      <Td w="6rem">
        <RerunTest testId={row.id} />
      </Td>
    </tr>
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
  const item = (to: string | undefined, label: string, count: number) => (
    <Link
      key={label}
      to="/tests"
      search={(prev) => ({ ...prev, file: to })}
      data-on={file === to || undefined}
      aria-current={file === to ? "page" : undefined}
      replace
    >
      <HStack
        justify="space-between"
        gap="2"
        h="8"
        px="2.5"
        rounded="lg"
        color="ink.soft"
        _hover={{ bg: "surface.hover", color: "ink.strong" }}
        css={{ "[data-on] > &": { bg: "surface.active", color: "ink.strong", fontWeight: "500" } }}
      >
        <styled.span overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={label}>
          {label}
        </styled.span>
        <styled.span color="ink.faint" fontSize="1">
          {count}
        </styled.span>
      </HStack>
    </Link>
  )

  return (
    <Stack as="nav" aria-label="Test files" gap="0.5">
      {item(undefined, "All tests", rows.length)}
      <styled.span color="ink.muted" fontSize="1" fontWeight="500" px="2.5" pt="3" pb="1">
        Files
      </styled.span>
      {files.map((each) =>
        item(
          each,
          each.replace(/^tests\//, ""),
          rows.filter((row) => (row.file ?? "other") === each).length,
        ),
      )}
    </Stack>
  )
}

/**
 * The project's test library: its files down the side, its tests in a table with how each did
 * last, how often it passes and what the fault matrix made of it. Pick some and run them, or run
 * the lot; a test's name opens its latest recording over the page.
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
  const pick = (id: string, on: boolean) =>
    setPicked((before) => {
      const next = new Set(before)

      if (on) next.add(id)
      else next.delete(id)

      return next
    })

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
      detail="Every test in this project. A name opens its latest recording; the matrix column says what the fault matrix made of it."
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
          <RowPanel overflowX="auto">
            <RowTable aria-label="Tests">
              <thead>
                <tr>
                  <Th>
                    <input
                      type="checkbox"
                      aria-label="Pick every test shown"
                      checked={found.shown.every((row) => picked.has(row.id))}
                      onChange={(event) =>
                        setPicked(
                          event.target.checked
                            ? new Set(found.shown.map((row) => row.id))
                            : new Set(),
                        )
                      }
                    />
                  </Th>
                  <Th display={{ base: "none", md: "table-cell" }}>
                    <styled.span srOnly>Recording</styled.span>
                  </Th>
                  <Th>Test</Th>
                  <Th>Last run</Th>
                  <Th textAlign="right" display={{ base: "none", lg: "table-cell" }}>
                    Pass rate
                  </Th>
                  <Th display={{ base: "none", lg: "table-cell" }}>Matrix</Th>
                  <Th>
                    <styled.span srOnly>Run again</styled.span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {found.shown.map((row) => (
                  <TestRowLine
                    key={row.id}
                    row={row}
                    picked={picked.has(row.id)}
                    onPick={(on) => pick(row.id, on)}
                  />
                ))}
              </tbody>
            </RowTable>
          </RowPanel>
        )}
      </Grid>
    </Page>
  )
}
