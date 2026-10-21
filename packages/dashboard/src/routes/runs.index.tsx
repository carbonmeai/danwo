import { createFileRoute } from "@tanstack/react-router"

import { useKeptQuery } from "../lib/kept-query.ts"
import { verdictParam } from "../lib/whose.ts"
import { fetchRuns } from "../modules/runs/runs-api.ts"
import type { RunFilter } from "../modules/runs/runs-data.ts"
import { RunsPage } from "../modules/runs/runs-page.tsx"
import { RunsSkeleton } from "../modules/runs/runs-skeleton.tsx"

/** The runs list's address: its filters, which page, and what the filter box holds. */
interface RunsSearch extends RunFilter {
  readonly page?: number
  readonly q?: string
}

const DAYS = new Set([1, 7, 30])

/** Which runs the address asks for: their kind, status, date and whose failures they had. */
function filterOf(search: Record<string, unknown>): RunFilter {
  const days = Number(search.days)
  const verdict = verdictParam(search.verdict)

  return {
    ...((search.kind === "test" || search.kind === "matrix") && { kind: search.kind }),
    ...((search.status === "passed" || search.status === "failed") && { status: search.status }),
    ...(DAYS.has(days) && { days }),
    ...(verdict !== undefined && { verdict }),
  }
}

function runsSearch(search: Record<string, unknown>): RunsSearch {
  const { day, page, q } = search

  return {
    ...filterOf(search),
    ...(typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && { day }),
    ...(typeof page === "number" && page > 0 && { page }),
    ...(typeof q === "string" && q !== "" && { q }),
  }
}

const RunsRoute = () => {
  const search = Route.useSearch()
  const query = useKeptQuery(search.q)

  return (
    <RunsPage runs={Route.useLoaderData()} filter={search} page={search.page ?? 0} query={query} />
  )
}

export const Route = createFileRoute("/runs/")({
  validateSearch: runsSearch,
  loaderDeps: ({ search }) => ({
    page: search.page ?? 0,
    filter: {
      kind: search.kind,
      status: search.status,
      days: search.days,
      day: search.day,
      verdict: search.verdict,
    },
  }),
  loader: ({ deps }) => fetchRuns({ data: deps }),
  component: RunsRoute,
  pendingComponent: () => <RunsSkeleton kind={Route.useSearch().kind} />,
})
