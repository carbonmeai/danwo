/** The workspace itself: its name, its subscription and the id support asks for. */
import { createFileRoute, getRouteApi } from "@tanstack/react-router"

import { Badge, statusLabel } from "../components/ui"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/settings/")({ component: General })

function General() {
  const { current } = workspaceRoute.useLoaderData()
  const { workspace } = current

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Workspace</h2>
      </div>
      <dl className="card-body grid grid-cols-[10rem_1fr] gap-y-3 text-sm">
        <dt className="text-muted">Name</dt>
        <dd>{workspace.name}</dd>
        <dt className="text-muted">Subscription</dt>
        <dd>
          <Badge tone={workspace.status === "past_due" ? "danger" : "info"}>
            {statusLabel(workspace.status)}
          </Badge>
        </dd>
        <dt className="text-muted">Workspace ID</dt>
        <dd className="font-mono text-xs">{workspace.id}</dd>
      </dl>
    </section>
  )
}
