/** Settings, in tabs: the workspace, its members, billing and usage. */
import { createFileRoute, getRouteApi, Link, Outlet, useRouterState } from "@tanstack/react-router"

import { Shell } from "../components/shell"
import { PageHeader } from "../components/ui"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/settings")({ component: Settings })

const TABS = [
  { path: "", label: "General" },
  { path: "/members", label: "Members" },
  { path: "/billing", label: "Billing" },
  { path: "/usage", label: "Usage" },
] as const

function Settings() {
  const { session, current } = workspaceRoute.useLoaderData()
  const path = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, "") })
  const base = `/w/${current.workspace.id}/settings`
  const active = TABS.find((tab) => path === `${base}${tab.path}`) ?? TABS[0]

  return (
    <Shell session={session} current={current} title={`Settings · ${active.label}`}>
      <PageHeader title="Settings" description={`Everything about ${current.workspace.name}.`} />
      <nav aria-label="Settings" className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            to={`${base}${tab.path}`}
            activeOptions={{ exact: true, includeSearch: false }}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-fg aria-[current=page]:border-[var(--kit-fg)] aria-[current=page]:font-medium aria-[current=page]:text-fg"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </Shell>
  )
}
