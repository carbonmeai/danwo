/** The first page after signing in: who you are, and how you can sign in. */
import { useEffect, useState } from "react"
import { Link } from "react-router"

import { authClient } from "../auth-client.ts"
import { providerName } from "./settings.tsx"

export function Dashboard() {
  const { data } = authClient.useSession()
  const [providers, setProviders] = useState<string[] | null>(null)
  const [devices, setDevices] = useState<number | null>(null)

  useEffect(() => {
    void authClient
      .listAccounts()
      .then(({ data }) => setProviders(data?.map((a) => a.providerId) ?? []))
    void authClient.listSessions().then(({ data }) => setDevices(data?.length ?? 0))
  }, [])

  if (!data) return null

  const name = data.user.name || data.user.email

  return (
    <div className="stack">
      <div className="page-header">
        <h1 className="page-title">Welcome, {name.split(" ")[0]}</h1>
        <p className="page-description">You&apos;re signed in to Harbor as {data.user.email}.</p>
      </div>
      <div className="stats">
        <section className="card stat">
          <span className="stat-label">Ways to sign in</span>
          <span className="stat-value" data-testid="ways-to-sign-in">
            {providers === null ? "…" : ["Emailed code", ...providers.map(providerName)].join(", ")}
          </span>
        </section>
        <section className="card stat">
          <span className="stat-label">Signed-in devices</span>
          <span className="stat-value" data-testid="device-count">
            {devices ?? "…"}
          </span>
        </section>
      </div>
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Your links</h2>
          <p className="card-description">Nothing saved yet.</p>
        </div>
        <div className="card-body">
          <p className="muted">
            Link Google or GitHub to this account, or sign out your other devices, from{" "}
            <Link to="/settings">Settings</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}
