import { createFileRoute } from "@tanstack/react-router"

import type { MatrixView } from "../modules/matrix/matrix-run.tsx"
import { RunPage } from "../modules/run/run-page.tsx"
import { fetchRun } from "../modules/runs/runs-api.ts"

const RunRoute = () => (
  <RunPage run={Route.useLoaderData()} view={Route.useSearch().view ?? "grid"} />
)

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: (search: Record<string, unknown>): { view?: MatrixView } =>
    search.view === "list" ? { view: "list" } : {},
  loader: ({ params }) => fetchRun({ data: params.runId }),
  component: RunRoute,
})
