import { createFileRoute } from "@tanstack/react-router"

import { fetchRecord } from "../modules/record/record-api.ts"
import { RecordPage } from "../modules/record/record-page.tsx"

const RecordRoute = () => <RecordPage view={Route.useLoaderData()} />

export const Route = createFileRoute("/records/$")({
  loader: ({ params }) => fetchRecord({ data: params._splat ?? "" }),
  component: RecordRoute,
})
