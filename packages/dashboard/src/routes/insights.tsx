import { createFileRoute } from "@tanstack/react-router"

import { fetchInsights } from "../modules/insights/insights-api.ts"
import { InsightsPage } from "../modules/insights/insights-page.tsx"
import { type BreakdownSort, isBreakdownSort } from "../modules/insights/test-breakdown.ts"

/** How the table of every test is sorted, as the address holds it. */
interface InsightsSearch {
  readonly sort?: BreakdownSort
  readonly dir?: "asc"
}

function insightsSearch(search: Record<string, unknown>): InsightsSearch {
  return {
    ...(isBreakdownSort(search.sort) && { sort: search.sort }),
    ...(search.dir === "asc" && { dir: "asc" }),
  }
}

const InsightsRoute = () => {
  const search = Route.useSearch()

  return (
    <InsightsPage
      insights={Route.useLoaderData()}
      sorting={{ sort: search.sort ?? "flake", ascending: search.dir === "asc" }}
    />
  )
}

export const Route = createFileRoute("/insights")({
  validateSearch: insightsSearch,
  loader: () => fetchInsights(),
  component: InsightsRoute,
})
