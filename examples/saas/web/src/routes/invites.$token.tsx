/** An invitation to a workspace: sign in (or up) with the invited address, then accept it. */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Logo } from "../components/shell"
import { Notice } from "../components/ui"
import { acceptInvite, getInvite, getSession } from "../lib/server"

export const Route = createFileRoute("/invites/$token")({
  loader: async ({ params }) => {
    const session = await getSession()

    /* After signing up, the front door finds this invitation waiting and comes back here. */
    if (!session) throw redirect({ to: "/sign-up/$", params: { _splat: "" } })

    return { invite: await getInvite({ data: { token: params.token } }), token: params.token }
  },
  component: InvitePage,
})

function InvitePage() {
  const { invite, token } = Route.useLoaderData()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function accept() {
    setBusy(true)

    const accepted = await acceptInvite({ data: { token } })

    if (accepted.ok) {
      await navigate({ to: "/w/$workspaceId", params: { workspaceId: accepted.data.workspaceId } })

      return
    }

    setError(accepted.error)
    setBusy(false)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <Logo />
      <section className="card">
        <div className="card-header">
          <h1 className="card-title text-xl">Join {invite.workspace.name}</h1>
          <p className="card-description">
            You've been invited to {invite.workspace.name} on Relay as {invite.email}.
          </p>
        </div>
        <div className="card-body stack">
          {error && <Notice tone="danger">{error}</Notice>}
          {invite.forYou ? (
            <button className="btn btn-primary" onClick={accept} aria-busy={busy} disabled={busy}>
              Accept the invitation
            </button>
          ) : (
            <Notice tone="danger">
              This invitation is for {invite.email}. Sign in with that address to accept it.
            </Notice>
          )}
        </div>
      </section>
    </main>
  )
}
