import { createFileRoute } from "@tanstack/react-router"

import { type TestFilter, isTestFilter } from "../modules/tests/test-values.ts"
import { fetchTests } from "../modules/tests/tests-api.ts"
import { TestsPage } from "../modules/tests/tests-page.tsx"

/** The tests list's address: which tab, and what the filter holds. */
interface TestsSearch {
  readonly filter?: TestFilter
  readonly q?: string
}

function testsSearch(search: Record<string, unknown>): TestsSearch {
  return {
    ...(isTestFilter(search.filter) && search.filter !== "all" && { filter: search.filter }),
    ...(typeof search.q === "string" && search.q !== "" && { q: search.q }),
  }
}

const TestsRoute = () => {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <TestsPage
      rows={Route.useLoaderData()}
      filter={search.filter ?? "all"}
      query={{
        query: search.q ?? "",
        onChange: (q) =>
          void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true }),
      }}
    />
  )
}

export const Route = createFileRoute("/")({
  validateSearch: testsSearch,
  loader: () => fetchTests(),
  component: TestsRoute,
})
