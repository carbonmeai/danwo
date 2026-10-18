import { Stack, styled } from "@danwo/ui/jsx"
import { type ColumnDef, DataGrid } from "@danwo/ui/primitives/data-grid"
import { createFileRoute, Link } from "@tanstack/react-router"

import { fetchInsights } from "../api.ts"
import { dollars, duration } from "../components/format.ts"
import { Code, Empty, PageTitle, StatusBadge } from "../components/status.tsx"
import type { TestInsight } from "../data/insights.ts"

export const Route = createFileRoute("/insights")({
  loader: () => fetchInsights(),
  component: InsightsPage,
})

const testColumn: ColumnDef<TestInsight> = {
  header: "Test",
  accessorKey: "id",
  cell: (c) => (
    <Link to="/runs/$runId" params={{ runId: c.row.original.lastRun }}>
      {c.row.original.id}
    </Link>
  ),
}
const lastColumn: ColumnDef<TestInsight> = {
  header: "Last",
  accessorKey: "lastStatus",
  size: 110,
  cell: (c) => <StatusBadge status={c.row.original.lastStatus} />,
}

const flakyColumns: ColumnDef<TestInsight>[] = [
  testColumn,
  { header: "Runs", accessorKey: "runs", size: 70 },
  { header: "Flaky", accessorKey: "flaky", size: 70 },
  { header: "Flips", accessorKey: "flips", size: 70 },
  { header: "Failed", accessorKey: "failed", size: 70 },
  lastColumn,
]

const slowColumns: ColumnDef<TestInsight>[] = [
  testColumn,
  { header: "Runs", accessorKey: "runs", size: 70 },
  {
    header: "Average",
    accessorKey: "averageMs",
    size: 100,
    cell: (c) => duration(c.row.original.averageMs),
  },
  lastColumn,
]

const costColumns: ColumnDef<TestInsight>[] = [
  testColumn,
  { header: "Model calls", accessorKey: "modelCalls", size: 110 },
  {
    header: "Cost",
    accessorKey: "costUsd",
    size: 100,
    cell: (c) => dollars(c.row.original.costUsd),
  },
  lastColumn,
]

function Table({
  title,
  rows,
  columns,
  empty,
}: {
  readonly title: string
  readonly rows: readonly TestInsight[]
  readonly columns: ColumnDef<TestInsight>[]
  readonly empty: string
}) {
  return (
    <Stack as="section" gap="3" mt="8" aria-label={title}>
      <styled.h2 fontSize="2" fontWeight="semibold">
        {title}
      </styled.h2>
      <DataGrid
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        height="24rem"
        empty={<styled.span color="text.secondary">{empty}</styled.span>}
      />
    </Stack>
  )
}

function InsightsPage() {
  const insights = Route.useLoaderData()

  if (insights.runs === 0)
    return (
      <Empty
        title="No test runs yet"
        hint={
          <>
            Insights come from the runs <Code>danwo test</Code> keeps in <Code>.danwo/history</Code>
            .
          </>
        }
      />
    )

  return (
    <>
      <PageTitle title="Insights" detail={`Across the latest ${insights.runs} test runs`} />
      <Table
        title="Flaky tests"
        rows={insights.flaky}
        columns={flakyColumns}
        empty="No test has flipped between passing and failing."
      />
      <Table
        title="Slowest tests"
        rows={insights.slowest}
        columns={slowColumns}
        empty="No tests yet."
      />
      <Table
        title="Costliest tests"
        rows={insights.costliest}
        columns={costColumns}
        empty="No test has called a model."
      />
    </>
  )
}
