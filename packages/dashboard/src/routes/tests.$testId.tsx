import { createFileRoute } from "@tanstack/react-router"

import { recordAnchor, useRecordAnchors } from "../lib/record-anchors.ts"
import { TestPage } from "../modules/tests/test-page.tsx"
import { type TestTab, isTestTab } from "../modules/tests/test-values.ts"
import { fetchTest } from "../modules/tests/tests-api.ts"

/**
 * A test's address: which recording plays (`record`, a record folder), which tab is open, and the
 * record anchors (`step`, `section`); `t` and `#step-N` start the player at a moment.
 */
interface TestSearch {
  readonly record?: string
  readonly tab?: TestTab
  readonly step?: number
  readonly section?: string
  readonly t?: number
}

function testSearch(search: Record<string, unknown>): TestSearch {
  const t = Number(search.t)

  return {
    ...recordAnchor(search),
    ...(typeof search.record === "string" && search.record !== "" && { record: search.record }),
    ...(isTestTab(search.tab) && search.tab !== "steps" && { tab: search.tab }),
    ...(search.t !== undefined && Number.isFinite(t) && t >= 0 && { t }),
  }
}

const TestRoute = () => {
  const search = Route.useSearch()

  useRecordAnchors(search)

  return <TestPage view={Route.useLoaderData()} tab={search.tab ?? "steps"} />
}

export const Route = createFileRoute("/tests/$testId")({
  validateSearch: testSearch,
  loaderDeps: ({ search }) => ({ record: search.record }),
  loader: ({ params, deps }) => fetchTest({ data: { id: params.testId, record: deps.record } }),
  component: TestRoute,
})
