import { createFileRoute } from "@tanstack/react-router"

import { fetchOverview } from "../modules/overview/overview-api.ts"
import { type Range, rangeOf } from "../modules/overview/overview-data.ts"
import { OverviewPage } from "../modules/overview/overview-page.tsx"
import { OverviewSkeleton } from "../modules/overview/overview-skeleton.tsx"

/** The overview's address: how many days it covers. */
interface OverviewSearch {
  readonly range?: Range
}

function overviewSearch(search: Record<string, unknown>): OverviewSearch {
  const range = rangeOf(search.range)

  return range === undefined || range === 30 ? {} : { range }
}

export const Route = createFileRoute("/")({
  validateSearch: overviewSearch,
  loaderDeps: ({ search }) => ({ range: search.range ?? 30 }),
  loader: ({ deps }) => fetchOverview({ data: deps.range }),
  component: () => <OverviewPage overview={Route.useLoaderData()} />,
  pendingComponent: () => <OverviewSkeleton range={Route.useSearch().range ?? 30} />,
})
