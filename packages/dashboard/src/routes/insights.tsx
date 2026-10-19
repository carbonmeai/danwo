import { createFileRoute } from "@tanstack/react-router"

import { fetchInsights } from "../modules/insights/insights-api.ts"
import { InsightsPage } from "../modules/insights/insights-page.tsx"

const InsightsRoute = () => <InsightsPage insights={Route.useLoaderData()} />

export const Route = createFileRoute("/insights")({
  loader: () => fetchInsights(),
  component: InsightsRoute,
})
