import { HStack, Stack } from "@danwo/ui/jsx"
import { TableCell, TableHead, TableRow } from "@danwo/ui/primitives/table"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"

import { Ident } from "../../components/code.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { PanelTable } from "../../components/panel.tsx"
import {
  Bone,
  BoneCell,
  BoneRow,
  ControlBone,
  lineWidth,
  Repeat,
} from "../../components/skeleton.tsx"
import { VerdictBadge } from "../../components/status-badge.tsx"
import { RunMatrix } from "../live/run-actions.tsx"
import { matrixWords } from "./test-values.ts"
import type { TestRow } from "./tests-data.ts"

/** Broken first, then never run under the matrix, then held; by name within each. */
const ORDER = { broke: 0, "clean-failed": 1, none: 2, held: 3 } as const

/** The faults that broke a test, as chips. */
function Faults({ row }: { readonly row: TestRow }) {
  if (row.matrix.kind !== "broke") return <Span color="ink.faint">–</Span>

  return (
    <HStack gap="1.5" flexWrap="wrap">
      {row.matrix.broke.map((fault) => (
        <VerdictBadge key={fault} tone="failed" fontFamily="mono">
          {fault}
        </VerdictBadge>
      ))}
    </HStack>
  )
}

/** What the latest matrix run made of a test, as a badge that opens it. */
function Latest({ row }: { readonly row: TestRow }) {
  if (row.matrix.kind === "none") return <Span color="ink.faint">{matrixWords(row.matrix)}</Span>

  return (
    <Link to="/runs/$runId" params={{ runId: row.matrix.runId }}>
      <VerdictBadge tone={row.matrix.kind === "held" ? "passed" : "failed"}>
        {row.matrix.kind === "held"
          ? matrixWords(row.matrix)
          : row.matrix.kind === "broke"
            ? `broke under ${row.matrix.broke.length} of ${row.matrix.judged}`
            : "clean run failed"}
      </VerdictBadge>
    </Link>
  )
}

/** The matrix table's header row. */
function MatrixHead() {
  return (
    <>
      <TableHead px="3" color="ink.muted">
        Test
      </TableHead>
      <TableHead color="ink.muted">Latest matrix run</TableHead>
      <TableHead color="ink.muted">Broke under</TableHead>
      <TableHead>
        <Span srOnly>Run the matrix</Span>
      </TableHead>
    </>
  )
}

/** Rows enough to fill a tall window; the page scrolls past the rest once they load. */
const SKELETON_ROWS = 14

/** What the matrix does, under its title. */
const MATRIX_DETAIL =
  "danwo matrix records one clean run of a test, then replays it once per fault its providers could throw (a declined card, a 500, a duplicate webhook, a race), and checks the test's invariant after each."

/** {@link MatrixPage} while the tests load: the same table, its rows as bones. */
export function MatrixPageSkeleton() {
  return (
    <Page crumbs={["Matrix"]} title="Matrix" detail={MATRIX_DETAIL} loading="Loading the matrix">
      <PanelTable label="Tests under the matrix" head={<MatrixHead />}>
        <Repeat count={SKELETON_ROWS}>
          {(i) => (
            <BoneRow key={i}>
              <BoneCell w="full" minW="16rem" px="3" whiteSpace="normal">
                <Bone w={lineWidth(i)} />
                <Repeat count={2}>
                  {(line) => <Bone key={line} w="full" display={{ base: "block", md: "none" }} />}
                </Repeat>
              </BoneCell>
              <BoneCell bone="6rem" />
              <BoneCell bone="1rem" />
              <BoneCell w="12rem">
                <ControlBone w="8.75rem" />
              </BoneCell>
            </BoneRow>
          )}
        </Repeat>
      </PanelTable>
    </Page>
  )
}

/**
 * The fault matrix across the suite: for each test, what its latest matrix run made of it and the
 * faults that broke it, with a way to run the matrix for any test.
 */
export function MatrixPage({ rows }: { readonly rows: readonly TestRow[] }) {
  const sorted = rows.toSorted(
    (a, b) => ORDER[a.matrix.kind] - ORDER[b.matrix.kind] || a.id.localeCompare(b.id),
  )

  return (
    <Page crumbs={["Matrix"]} title="Matrix" detail={MATRIX_DETAIL}>
      {rows.length === 0 ? (
        <Empty
          title="No tests yet"
          hint="Once the project has tests, run the matrix on one."
          command="danwo matrix <test file>"
        />
      ) : (
        <PanelTable label="Tests under the matrix" head={<MatrixHead />}>
          {sorted.map((row) => (
            <TableRow key={row.id} data-row>
              <TableCell minW="16rem" px="3" whiteSpace="normal">
                <Stack gap="0.5">
                  <Span fontWeight="500" overflowWrap="anywhere">
                    {row.id}
                  </Span>
                  {row.file ? (
                    <Ident color="ink.muted" fontSize="1">
                      {row.file}
                    </Ident>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                <Latest row={row} />
              </TableCell>
              <TableCell whiteSpace="normal">
                <Faults row={row} />
              </TableCell>
              <TableCell w="12rem" textAlign="right">
                <RunMatrix testId={row.id} />
              </TableCell>
            </TableRow>
          ))}
        </PanelTable>
      )}
    </Page>
  )
}
