import { createFileRoute } from "@tanstack/react-router"

import { fetchRuns } from "../modules/runs/runs-api.ts"
import { RunsPage } from "../modules/runs/runs-page.tsx"

const RunsRoute = () => <RunsPage runs={Route.useLoaderData()} page={Route.useSearch().page ?? 0} />

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { page?: number } =>
    typeof search.page === "number" && search.page > 0 ? { page: search.page } : {},
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: ({ deps }) => fetchRuns({ data: deps.page }),
  component: RunsRoute,
})
