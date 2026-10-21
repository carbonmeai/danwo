/** How much of the plan the workspace uses: members and notes this month. */
import { createFileRoute, getRouteApi } from "@tanstack/react-router"

import { UsageMeter } from "../components/ui"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/settings/usage")({ component: Usage })

function Usage() {
  const { current } = workspaceRoute.useLoaderData()
  const { usage } = current

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">This month</h2>
        <p className="card-description">Counted against your plan's allowance.</p>
      </div>
      <div className="card-body grid gap-6 md:grid-cols-2">
        <UsageMeter label="Members" used={usage.members.used} limit={usage.members.limit} />
        <UsageMeter label="Notes published" used={usage.notes.used} limit={usage.notes.limit} />
      </div>
    </section>
  )
}
