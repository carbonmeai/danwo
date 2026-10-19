import { createFileRoute } from "@tanstack/react-router"

import { recordAnchor, useRecordAnchors } from "../lib/record-anchors.ts"
import { RecordDock } from "../modules/live/run-actions.tsx"
import { fetchRecord } from "../modules/record/record-api.ts"
import { RecordPage } from "../modules/record/record-page.tsx"

const RecordRoute = () => {
  const view = Route.useLoaderData()

  useRecordAnchors(Route.useSearch())

  return (
    <>
      <RecordPage view={view} />
      {view ? <RecordDock testId={view.record.test} /> : null}
    </>
  )
}

export const Route = createFileRoute("/records/$")({
  validateSearch: recordAnchor,
  loader: ({ params }) => fetchRecord({ data: params._splat ?? "" }),
  component: RecordRoute,
})
