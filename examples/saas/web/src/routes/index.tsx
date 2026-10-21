/**
 * The front door: signed out, what Relay is; signed in, straight to your workspace, an invitation
 * waiting for you, or onboarding when you have neither.
 */
import { createFileRoute, redirect } from "@tanstack/react-router"

import { Logo } from "../components/shell"
import { getSession } from "../lib/server"

export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getSession()

    if (!session) return null

    const [first] = session.workspaces
    const [invite] = session.invites

    if (first) throw redirect({ to: "/w/$workspaceId", params: { workspaceId: first.id } })
    if (invite) throw redirect({ to: "/invites/$token", params: { token: invite.token } })
    throw redirect({ to: "/onboarding" })
  },
  component: Landing,
})

function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Logo />
        <a className="btn btn-ghost btn-sm" href="/sign-in">
          Sign in
        </a>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-6 px-6 pb-24">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
          Keep your team in the loop
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Relay is where your team writes short notes (updates, decisions, roadmaps) and everyone
          sees them the moment they're published, in Relay and in Slack.
        </p>
        <div className="flex gap-3">
          <a className="btn btn-primary btn-lg" href="/sign-up">
            Start a free trial
          </a>
          <a className="btn btn-secondary btn-lg" href="/sign-in">
            Sign in
          </a>
        </div>
        <p className="text-sm text-muted">14 days of the Team plan. No card needed to start.</p>
      </main>
    </div>
  )
}
