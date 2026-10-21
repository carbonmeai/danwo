import { createFileRoute } from "@tanstack/react-router"

import { fetchImpact } from "../modules/impact/impact-api.ts"
import { ImpactPage, ImpactSkeleton } from "../modules/impact/impact-page.tsx"

const ImpactRoute = () => <ImpactPage rows={Route.useLoaderData()} />

export const Route = createFileRoute("/impact")({
  loader: () => fetchImpact(),
  component: ImpactRoute,
  pendingComponent: ImpactSkeleton,
})
