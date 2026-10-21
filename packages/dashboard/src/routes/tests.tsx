import type { Verdict } from "@danwo/runner/runner"
import { createFileRoute } from "@tanstack/react-router"

import { useKeptQuery } from "../lib/kept-query.ts"
import { verdictParam } from "../lib/whose.ts"
import { fetchTests } from "../modules/tests/tests-api.ts"
import { TestsPage } from "../modules/tests/tests-page.tsx"
import { TestsSkeleton } from "../modules/tests/tests-skeleton.tsx"

/** The test library's address: which file, whose failures, and what the filter holds. */
interface TestsSearch {
  readonly file?: string
  readonly verdict?: Verdict
  readonly q?: string
}

function testsSearch(search: Record<string, unknown>): TestsSearch {
  const verdict = verdictParam(search.verdict)

  return {
    ...(typeof search.file === "string" && search.file !== "" && { file: search.file }),
    ...(verdict !== undefined && { verdict }),
    ...(typeof search.q === "string" && search.q !== "" && { q: search.q }),
  }
}

const TestsRoute = () => {
  const search = Route.useSearch()
  const query = useKeptQuery(search.q)
  const { rows, keepRuns } = Route.useLoaderData()

  return (
    <TestsPage
      rows={rows}
      keepRuns={keepRuns}
      file={search.file}
      verdict={search.verdict}
      query={query}
    />
  )
}

export const Route = createFileRoute("/tests")({
  validateSearch: testsSearch,
  loader: () => fetchTests(),
  component: TestsRoute,
  pendingComponent: TestsSkeleton,
})
