import { createFileRoute, redirect } from "@tanstack/react-router"

import { recordAnchor } from "../lib/record-anchors.ts"
import { fetchRecordTest } from "../modules/tests/tests-api.ts"

/**
 * A flight record's old address. A record now plays on its test's page, so this sends the browser
 * there with the record picked, keeping the step, section and moment it pointed at.
 */
export const Route = createFileRoute("/records/$")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...recordAnchor(search),
    ...(search.t !== undefined && { t: Number(search.t) }),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const dir = params._splat ?? ""
    const testId = await fetchRecordTest({ data: dir })

    if (testId === null) throw redirect({ to: "/" })

    throw redirect({ to: "/tests/$testId", params: { testId }, search: { ...deps, record: dir } })
  },
})
