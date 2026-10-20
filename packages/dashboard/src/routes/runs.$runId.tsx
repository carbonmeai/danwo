import { createFileRoute } from "@tanstack/react-router"

import { fetchLiveRun } from "../modules/live/live-api.ts"
import type { MatrixView } from "../modules/matrix/matrix-run.tsx"
import { RunPage } from "../modules/run/run-page.tsx"
import { fetchRun } from "../modules/runs/runs-api.ts"

/** What a run's address can point at inside it: the matrix view, a test, a trial. */
interface RunSearch {
  readonly view?: MatrixView
  readonly test?: string
  readonly trial?: string
}

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined)

function runSearch(search: Record<string, unknown>): RunSearch {
  const test = text(search.test)
  const trial = text(search.trial)

  return {
    ...(search.view === "list" && { view: "list" }),
    ...(test !== undefined && { test }),
    ...(trial !== undefined && { trial }),
  }
}

const RunRoute = () => {
  const { found, live } = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <RunPage
      run={found?.run ?? null}
      recordings={found?.recordings}
      live={live}
      view={search.view ?? "grid"}
      search={search}
    />
  )
}

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: runSearch,
  loader: async ({ params }) => {
    const found = await fetchRun({ data: params.runId })

    return {
      found,
      live: found === null ? await fetchLiveRun({ data: params.runId }) : null,
    }
  },
  component: RunRoute,
})
