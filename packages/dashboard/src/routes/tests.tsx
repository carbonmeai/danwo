import { createFileRoute } from "@tanstack/react-router"

import { useKeptQuery } from "../lib/kept-query.ts"
import { fetchTests } from "../modules/tests/tests-api.ts"
import { TestsPage } from "../modules/tests/tests-page.tsx"

/** The test library's address: which file, and what the filter holds. */
interface TestsSearch {
  readonly file?: string
  readonly q?: string
}

function testsSearch(search: Record<string, unknown>): TestsSearch {
  return {
    ...(typeof search.file === "string" && search.file !== "" && { file: search.file }),
    ...(typeof search.q === "string" && search.q !== "" && { q: search.q }),
  }
}

const TestsRoute = () => {
  const search = Route.useSearch()
  const query = useKeptQuery(search.q)

  return <TestsPage rows={Route.useLoaderData()} file={search.file} query={query} />
}

export const Route = createFileRoute("/tests")({
  validateSearch: testsSearch,
  loader: () => fetchTests(),
  component: TestsRoute,
})
