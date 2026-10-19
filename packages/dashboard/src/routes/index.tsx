import { createFileRoute } from "@tanstack/react-router"

import { fetchRuns } from "../modules/runs/runs-api.ts"
import { RunsPage } from "../modules/runs/runs-page.tsx"

/** The runs list's address: which page, and what the filter holds. */
interface RunsSearch {
  readonly page?: number
  readonly q?: string
}

function runsSearch(search: Record<string, unknown>): RunsSearch {
  return {
    ...(typeof search.page === "number" && search.page > 0 && { page: search.page }),
    ...(typeof search.q === "string" && search.q !== "" && { q: search.q }),
  }
}

const RunsRoute = () => {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <RunsPage
      runs={Route.useLoaderData()}
      page={search.page ?? 0}
      query={{
        query: search.q ?? "",
        onChange: (q) =>
          void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true }),
      }}
    />
  )
}

export const Route = createFileRoute("/")({
  validateSearch: runsSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: ({ deps }) => fetchRuns({ data: deps.page }),
  component: RunsRoute,
})
