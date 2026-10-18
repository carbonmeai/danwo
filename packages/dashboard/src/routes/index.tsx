import { HStack, styled } from "@danwo/ui/jsx"
import { type ColumnDef, DataGrid } from "@danwo/ui/primitives/data-grid"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"

import { fetchRuns } from "../api.ts"
import { dollars, duration, when } from "../components/format.ts"
import { Code, Empty, PageTitle } from "../components/status.tsx"
import type { RunRow } from "../data/runs.ts"

const PAGE_SIZE = 50

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { page?: number } =>
    typeof search.page === "number" && search.page > 0 ? { page: search.page } : {},
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: ({ deps }) => fetchRuns({ data: deps.page }),
  component: RunsPage,
})

/** The counts a row shows, skipping the ones that are zero. */
function Counts({ row }: { readonly row: RunRow }) {
  const parts: [string, number, string][] = [
    ["passed", row.counts.passed, "brand.success.11"],
    ["failed", row.counts.failed, "brand.error.11"],
    ["flaky", row.counts.flaky, "brand.warning.11"],
    ["not judged", row.counts.notJudged, "brand.info.11"],
    ["invalid", row.counts.invalid, "text.secondary"],
    ["skipped", row.counts.skipped, "text.secondary"],
  ]

  return (
    <HStack gap="2">
      {parts
        .filter(([, n]) => n > 0)
        .map(([word, n, color]) => (
          <styled.span key={word} color={color} data-count={word}>
            {n} {word}
          </styled.span>
        ))}
    </HStack>
  )
}

const columns: ColumnDef<RunRow>[] = [
  {
    header: "Started",
    accessorKey: "startedAt",
    size: 170,
    cell: (c) => when(c.row.original.startedAt),
  },
  { header: "Command", accessorKey: "kind", size: 90, cell: (c) => `danwo ${c.row.original.kind}` },
  {
    header: "What ran",
    accessorKey: "title",
    cell: (c) => (
      <Link to="/runs/$runId" params={{ runId: c.row.original.id }}>
        {c.row.original.title}
      </Link>
    ),
  },
  {
    header: "Result",
    id: "counts",
    enableSorting: false,
    cell: (c) => <Counts row={c.row.original} />,
  },
  {
    header: "Time",
    accessorKey: "durationMs",
    size: 90,
    cell: (c) => duration(c.row.original.durationMs),
  },
  { header: "Model calls", accessorKey: "modelCalls", size: 100 },
  {
    header: "Cost",
    accessorKey: "costUsd",
    size: 90,
    cell: (c) => dollars(c.row.original.costUsd),
  },
]

function RunsPage() {
  const { rows, total } = Route.useLoaderData()
  const { page = 0 } = Route.useSearch()
  const navigate = useNavigate()
  const pages = Math.ceil(total / PAGE_SIZE)

  if (total === 0)
    return (
      <Empty
        title="No runs yet"
        hint={
          <>
            Run <Code>danwo test</Code> or <Code>danwo matrix &lt;test file&gt;</Code> in this
            project, then reload.
          </>
        }
      />
    )

  return (
    <>
      <PageTitle title="Runs" detail={`${total} runs, newest first`} />
      <DataGrid
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(row) => void navigate({ to: "/runs/$runId", params: { runId: row.id } })}
        height="70vh"
      />
      {pages > 1 ? (
        <HStack justify="flex-end" gap="3" mt="3" fontSize="1">
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
      ) : null}
    </>
  )
}
