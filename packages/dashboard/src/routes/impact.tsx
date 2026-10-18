import { Stack, styled } from "@danwo/ui/jsx"
import { type ColumnDef, DataGrid } from "@danwo/ui/primitives/data-grid"
import { createFileRoute } from "@tanstack/react-router"

import { fetchImpact } from "../api.ts"
import { Code, Empty, PageTitle } from "../components/status.tsx"
import type { ImpactRow } from "../data/impact.ts"

export const Route = createFileRoute("/impact")({
  loader: () => fetchImpact(),
  component: ImpactPage,
})

/** A list cell: the items one per line, or a dash. */
function Lines({ items }: { readonly items: readonly string[] }) {
  return items.length === 0 ? (
    <span>–</span>
  ) : (
    <Stack gap="0" fontFamily="mono" fontSize="0.5" title={items.join("\n")}>
      {items.join(", ")}
    </Stack>
  )
}

const columns: ColumnDef<ImpactRow>[] = [
  { header: "Test", accessorKey: "test" },
  {
    header: "Providers",
    id: "providers",
    size: 200,
    enableSorting: false,
    cell: (c) => <Lines items={c.row.original.providers} />,
  },
  {
    header: "App routes",
    id: "routes",
    size: 200,
    enableSorting: false,
    cell: (c) => <Lines items={c.row.original.routes} />,
  },
  {
    header: "Webhooks",
    id: "webhooks",
    size: 220,
    enableSorting: false,
    cell: (c) => <Lines items={c.row.original.webhooks} />,
  },
  {
    header: "Calls",
    id: "calls",
    enableSorting: false,
    cell: (c) => <Lines items={c.row.original.calls} />,
  },
]

function ImpactPage() {
  const rows = Route.useLoaderData()

  if (rows.length === 0)
    return (
      <Empty
        title="No impact index yet"
        hint={
          <>
            Every passing test adds what it touched to <Code>.danwo/impact.json</Code>. Run{" "}
            <Code>danwo test</Code> first.
          </>
        }
      />
    )

  return (
    <>
      <PageTitle
        title="Impact"
        detail={
          <>
            What each test touches behind the app; <Code>danwo test --changed</Code> picks tests
            from it.
          </>
        }
      />
      <styled.div>
        <DataGrid data={rows} columns={columns} getRowId={(row) => row.test} height="70vh" />
      </styled.div>
    </>
  )
}
