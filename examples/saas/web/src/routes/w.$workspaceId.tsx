/** Inside a workspace: who you are, your workspaces, and this one, for every page under it. */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { getSession, getWorkspace } from "../lib/server"

export const Route = createFileRoute("/w/$workspaceId")({
  loader: async ({ params }) => {
    const session = await getSession()

    if (!session) throw redirect({ to: "/sign-in/$", params: { _splat: "" } })

    const current = await getWorkspace({ data: { id: params.workspaceId } })

    return { session, current }
  },
  component: Outlet,
})
