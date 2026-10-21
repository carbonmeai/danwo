/**
 * The app frame inside a workspace: a sidebar with the workspace switcher and the sections, a top
 * bar with where you are and your account, and a banner while the trial runs or a payment failed.
 */
import { UserButton } from "@clerk/tanstack-react-start"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"

import type { Session, Workspace } from "../lib/types"
import { daysUntil } from "./ui"

export function Logo() {
  return (
    <span className="shell-brand">
      <span className="shell-logo" aria-hidden="true">
        R
      </span>
      Relay
    </span>
  )
}

/** Every workspace you belong to, and a way to make another. */
function WorkspaceSwitcher({
  session,
  current,
}: {
  readonly session: Session
  readonly current: Workspace
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative px-1">
      <button
        type="button"
        aria-label={`Workspace: ${current.workspace.name}. Switch workspace`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-surface px-2.5 text-sm font-medium hover:bg-[var(--kit-bg-hover)]"
      >
        <span className="truncate">{current.workspace.name}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          ▾
        </span>
      </button>
      <div
        hidden={!open}
        className="absolute inset-x-1 top-10 z-20 rounded-lg border border-border bg-surface p-1 shadow-lg"
      >
        <p className="px-2 py-1 text-xs text-muted">Workspaces</p>
        <ul aria-label="Your workspaces">
          {session.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <a
                href={`/w/${workspace.id}`}
                aria-current={workspace.id === current.workspace.id ? "true" : undefined}
                className="flex h-8 items-center rounded-md px-2 text-sm hover:bg-[var(--kit-bg-hover)] aria-[current=true]:font-medium"
              >
                {workspace.name}
              </a>
            </li>
          ))}
        </ul>
        <a
          href="/onboarding"
          className="mt-1 flex h-8 items-center rounded-md border-t border-border px-2 text-sm text-muted hover:text-fg"
        >
          + New workspace
        </a>
      </div>
    </div>
  )
}

/** What the trial or a failed payment means for you, with the way to fix it. */
function BillingBanner({ current }: { readonly current: Workspace }) {
  const { workspace } = current
  const billing = `/w/${workspace.id}/settings/billing`

  if (workspace.status === "past_due")
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 border-b border-[var(--kit-danger-border)] bg-[var(--kit-danger-bg)] px-6 py-2 text-sm"
      >
        <span>
          <strong>Payment failed.</strong> Your last invoice couldn't be paid, so the workspace is
          past due.
        </span>
        <a className="btn btn-sm btn-danger" href={billing}>
          Update the card
        </a>
      </div>
    )

  if (workspace.status === "trialing" && workspace.trialEndsAt) {
    const days = daysUntil(workspace.trialEndsAt)

    return (
      <div className="flex items-center justify-between gap-3 border-b border-[var(--kit-info-border)] bg-[var(--kit-info-bg)] px-6 py-2 text-sm">
        <span data-testid="trial-banner">
          Trial: {days} {days === 1 ? "day" : "days"} left on the Team plan.
          {workspace.hasPaymentMethod ? " Your card is on file." : ""}
        </span>
        {!workspace.hasPaymentMethod && (
          <a className="btn btn-sm btn-secondary" href={billing}>
            Add a card
          </a>
        )}
      </div>
    )
  }

  return null
}

/**
 * A section in the sidebar. The router marks the one you're in with `aria-current="page"`: Notes
 * only on its own page and a note's, Integrations and Settings on any of their tabs.
 */
function NavLink({
  to,
  exact,
  children,
}: {
  readonly to: string
  readonly exact?: boolean
  readonly children: ReactNode
}) {
  return (
    <Link to={to} activeOptions={{ exact: exact ?? false, includeSearch: false }}>
      {children}
    </Link>
  )
}

export function Shell({
  session,
  current,
  title,
  children,
}: {
  readonly session: Session
  readonly current: Workspace
  readonly title: string
  readonly children: ReactNode
}) {
  const base = `/w/${current.workspace.id}`

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <Logo />
        <WorkspaceSwitcher session={session} current={current} />
        <nav className="shell-nav" aria-label="Workspace">
          <NavLink to={base} exact>
            Notes
          </NavLink>
          <NavLink to={`${base}/integrations`}>Integrations</NavLink>
          <NavLink to={`${base}/settings`}>Settings</NavLink>
        </nav>
        <p className="shell-sidebar-footer">Signed in as {session.me.email}</p>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>{current.workspace.name}</span>
            <span aria-current="page">{title}</span>
          </nav>
          <UserButton />
        </header>
        <BillingBanner current={current} />
        <main className="shell-content">{children}</main>
      </div>
    </div>
  )
}
