import { HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { Ident } from "../../components/code.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Badge } from "../../components/status-badge.tsx"
import { RowPanel, RowTable, Td, Th } from "../../components/table.tsx"
import { RunMatrix } from "../live/run-actions.tsx"
import { matrixWords } from "./test-values.ts"
import type { TestRow } from "./tests-data.ts"

/** Broken first, then never run under the matrix, then held; by name within each. */
const ORDER = { broke: 0, "clean-failed": 1, none: 2, held: 3 } as const

/** The faults that broke a test, as chips. */
function Faults({ row }: { readonly row: TestRow }) {
  if (row.matrix.kind !== "broke") return <styled.span color="ink.faint">–</styled.span>

  return (
    <HStack gap="1.5" flexWrap="wrap">
      {row.matrix.broke.map((fault) => (
        <Ident key={fault} color="verdict.failed.fg" fontSize="1">
          {fault}
        </Ident>
      ))}
    </HStack>
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
    <Page
      crumbs={["Matrix"]}
      title="Matrix"
      detail="danwo matrix records one clean run of a test, then replays it once per fault its providers could throw (a declined card, a 500, a duplicate webhook, a race), and checks the test's invariant after each."
    >
      {rows.length === 0 ? (
        <Empty
          title="No tests yet"
          hint="Once the project has tests, run the matrix on one."
          command="danwo matrix <test file>"
        />
      ) : (
        <RowPanel overflowX="auto">
          <RowTable aria-label="Tests under the matrix">
            <thead>
              <tr>
                <Th>Test</Th>
                <Th>Latest matrix run</Th>
                <Th>Broke under</Th>
                <Th>
                  <styled.span srOnly>Run the matrix</styled.span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.id} data-row>
                  <Td minW="16rem">
                    <Stack gap="0.5">
                      <styled.span fontWeight="500" overflowWrap="anywhere">
                        {row.id}
                      </styled.span>
                      {row.file ? (
                        <Ident color="ink.muted" fontSize="1">
                          {row.file}
                        </Ident>
                      ) : null}
                    </Stack>
                  </Td>
                  <Td whiteSpace="nowrap">
                    {row.matrix.kind === "none" ? (
                      <styled.span color="ink.faint">{matrixWords(row.matrix)}</styled.span>
                    ) : (
                      <Link to="/runs/$runId" params={{ runId: row.matrix.runId }}>
                        <Badge tone={row.matrix.kind === "held" ? "passed" : "failed"}>
                          {row.matrix.kind === "held"
                            ? matrixWords(row.matrix)
                            : row.matrix.kind === "broke"
                              ? `broke under ${row.matrix.broke.length} of ${row.matrix.judged}`
                              : "clean run failed"}
                        </Badge>
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <Faults row={row} />
                  </Td>
                  <Td w="12rem" textAlign="right">
                    <RunMatrix testId={row.id} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </RowTable>
        </RowPanel>
      )}
    </Page>
  )
}
