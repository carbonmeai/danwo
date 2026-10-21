import { createFileRoute } from "@tanstack/react-router"

import { fetchInsights } from "../modules/insights/insights-api.ts"
import { InsightsPage } from "../modules/insights/insights-page.tsx"
import { InsightsSkeleton } from "../modules/insights/insights-skeleton.tsx"
import { type BreakdownSort, isBreakdownSort } from "../modules/insights/test-breakdown.ts"
import type { TableOrder } from "../modules/insights/test-table.tsx"

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

/** How the address sorts the table of every test. */
function useSorting(): TableOrder {
  const search = Route.useSearch()

  return { sort: search.sort ?? "flake", ascending: search.dir === "asc" }
}

const InsightsRoute = () => <InsightsPage insights={Route.useLoaderData()} sorting={useSorting()} />

export const Route = createFileRoute("/insights")({
  validateSearch: insightsSearch,
  loader: () => fetchInsights(),
  component: InsightsRoute,
  pendingComponent: () => <InsightsSkeleton sorting={useSorting()} />,
})
