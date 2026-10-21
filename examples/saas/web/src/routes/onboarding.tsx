/**
 * Onboarding: name your workspace, and Relay makes it, its Clerk organization and a trialing
 * subscription. The form carries a key made when the page loaded, so pressing the button twice,
 * or again after an error, finishes the same workspace instead of starting a second.
 */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"

import { Logo } from "../components/shell"
import { Notice } from "../components/ui"
import { createWorkspace, getSession } from "../lib/server"

export const Route = createFileRoute("/onboarding")({
  loader: async () => {
    const session = await getSession()

    if (!session) throw redirect({ to: "/sign-in/$", params: { _splat: "" } })

    return { session, onboardingKey: crypto.randomUUID() }
  },
  component: Onboarding,
})

function Onboarding() {
  const { session, onboardingKey } = Route.useLoaderData()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const first = session.workspaces.length === 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const fields = new FormData(event.currentTarget)
    const yourName = String(fields.get("yourName") ?? "")
    const name = String(fields.get("name") ?? "")

    setBusy(true)
    setError(undefined)

    const made = await createWorkspace({ data: { yourName, name, onboardingKey } })

    if (made.ok) {
      await navigate({
        to: "/w/$workspaceId",
        params: { workspaceId: made.data.id },
        search: { welcome: 1 },
      })

      return
    }

    setError(made.error)
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-14 w-full max-w-3xl items-center px-6">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
        <ol className="stepper" aria-label="Getting started">
          <li className="is-done">Your account</li>
          <li aria-current="step">Your workspace</li>
          <li>Your trial</li>
        </ol>
        <section className="card">
          <div className="card-header">
            <h1 className="card-title text-xl">
              {first ? "Welcome to Relay. Set up your workspace" : "Set up another workspace"}
            </h1>
            <p className="card-description">
              A workspace is where your team's notes live. It starts with 14 days of the Team plan,
              free.
            </p>
          </div>
          <form className="card-body stack" onSubmit={submit}>
            {error && (
              <Notice tone="danger" title="We couldn't finish setting up your workspace">
                {error} Press Create workspace again to carry on where it stopped.
              </Notice>
            )}
            <div className="field">
              <label className="label" htmlFor="your-name">
                Your name
              </label>
              <input
                id="your-name"
                name="yourName"
                className="input"
                required
                maxLength={80}
                defaultValue={session.me.name ?? ""}
                autoComplete="name"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="name">
                Workspace name
              </label>
              <input
                id="name"
                name="name"
                className="input"
                required
                minLength={2}
                maxLength={60}
                placeholder="Acme"
                autoComplete="organization"
              />
              <p className="hint">Usually your company or team.</p>
            </div>
            <div>
              <button className="btn btn-primary" type="submit" aria-busy={busy} disabled={busy}>
                Create workspace
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  )
}
