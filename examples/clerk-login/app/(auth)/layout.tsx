import type { ReactNode } from "react"

import { Logo } from "../logo.tsx"

/**
 * Every sign-in and sign-up page: the brand above one bordered card, Clerk's form on one side and
 * a word on what Lumen is on the other, so the card never moves between steps.
 */
export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="auth">
      <Logo />
      <main className="auth-card">
        <div className="auth-form">{children}</div>
        <aside className="auth-aside">
          <h2>Notes your whole team can find.</h2>
          <p className="muted">
            Lumen keeps a team&apos;s decisions, runbooks and meeting notes in one place, searchable
            by everyone in the organization.
          </p>
          <p className="muted">
            Sign in with a code we email you, or with Google. Invite your team once you&apos;re in.
          </p>
        </aside>
      </main>
      <p className="muted text-xs">Lumen, tested with danwo</p>
    </div>
  )
}
