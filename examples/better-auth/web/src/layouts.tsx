/**
 * The two frames every page sits in: one card for signing in and up, and the signed-in app's
 * sidebar and top bar, which sends anyone signed out to the sign-in page.
 */
import { type ReactNode, useState } from "react"
import { Navigate, NavLink, Outlet, useNavigate } from "react-router"

import { authClient } from "./auth-client.ts"

/** Harbor's mark and name. */
export function Logo() {
  return (
    <span className="shell-brand">
      <svg className="shell-logo" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2v14M7 7h10M4 13a8 8 0 0 0 16 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      Harbor
    </span>
  )
}

/** The sign-in and sign-up pages: the brand above one card, the form beside a word on Harbor. */
export function AuthLayout({ children }: { readonly children: ReactNode }) {
  const { data, isPending } = authClient.useSession()

  if (!isPending && data) return <Navigate to="/dashboard" replace />

  return (
    <div className="auth">
      <Logo />
      <main className="auth-card">
        <div className="auth-form">{children}</div>
        <aside className="auth-aside">
          <h2>Your team&apos;s links, in one safe place.</h2>
          <p className="muted">
            Harbor keeps the docs, dashboards and runbooks your team opens every day, behind a
            sign-in you run yourself.
          </p>
          <p className="muted">
            Sign in with a code we email you, with Google or GitHub, or with a password. Link them
            all to one account from your settings.
          </p>
        </aside>
      </main>
      <p className="muted text-xs">Harbor, tested with danwo</p>
    </div>
  )
}

const LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/settings", label: "Settings" },
] as const

/** The signed-in app. Anyone without a session goes to sign in. */
export function AppLayout() {
  const { data, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  if (isPending) return <p className="loading">Loading…</p>
  if (!data) return <Navigate to="/sign-in" replace />

  async function signOut() {
    setBusy(true)
    await authClient.signOut()
    await navigate("/sign-in")
  }

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <Logo />
        <nav className="shell-nav" aria-label="Main">
          <span className="shell-nav-label">Harbor</span>
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <p className="shell-sidebar-footer">Tested with danwo</p>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <span className="muted text-sm" data-testid="signed-in-as">
            {data.user.email}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={signOut}
          >
            Sign out
          </button>
        </header>
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
