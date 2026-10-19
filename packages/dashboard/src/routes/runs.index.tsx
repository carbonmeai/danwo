import { createFileRoute } from "@tanstack/react-router"

import { fetchRuns } from "../modules/runs/runs-api.ts"
import type { RunKind } from "../modules/runs/runs-data.ts"
import { RunsPage } from "../modules/runs/runs-page.tsx"

/** The runs list's address: which kind of run, which page, and what the filter holds. */
interface RunsSearch {
  readonly kind?: RunKind
  readonly page?: number
  readonly q?: string
}

function runsSearch(search: Record<string, unknown>): RunsSearch {
  return {
    ...(search.kind === "matrix" && { kind: "matrix" }),
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
      kind={search.kind ?? "test"}
      page={search.page ?? 0}
      query={{
        query: search.q ?? "",
        onChange: (q) =>
          void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true }),
      }}
    />
  )
}

export const Route = createFileRoute("/runs/")({
  validateSearch: runsSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 0, kind: search.kind ?? "test" }),
  loader: ({ deps }) => fetchRuns({ data: deps }),
  component: RunsRoute,
})
