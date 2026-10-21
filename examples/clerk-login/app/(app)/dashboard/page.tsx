import { auth } from "@clerk/nextjs/server"
import Link from "next/link"

import { appUser } from "../../../lib/accounts.ts"
import { once, within } from "../../../lib/clerk.ts"
import { AutoRefresh } from "../auto-refresh.tsx"

export const dynamic = "force-dynamic"

/**
 * Where everyone lands after signing in or up. Clerk has the person straight away; the app's own
 * row comes from Clerk's `user.created` webhook, which may land a moment after the redirect, so
 * until it does the page says so and looks again. When Clerk can't be reached, the app's own row
 * still has their name.
 */
export default async function Dashboard() {
  const { userId } = await auth.protect()
  const [user, row] = await Promise.all([
    within(
      2_000,
      once((clerk) => clerk.users.getUser(userId)),
    ).catch(() => undefined),
    appUser(userId).catch(() => undefined),
  ])
  /* Clerk's name for them, else the one Clerk's webhook gave the app, else their address. */
  const name =
    user?.firstName ?? row?.first_name ?? user?.primaryEmailAddress?.emailAddress ?? row?.email

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">{name === undefined ? "Welcome" : `Welcome, ${name}`}</h1>
        {name === undefined && <AutoRefresh />}
        <p className="page-description">
          Your notes, your organization and the people in it are a click away.
        </p>
      </header>

      <section className="card" aria-labelledby="account-title">
        <div className="card-header">
          <h2 className="card-title" id="account-title">
            Your Lumen account
          </h2>
          <p className="card-description">What Lumen keeps about you, from Clerk.</p>
        </div>
        <div className="card-body">
          {row ? (
            <p role="status" className="row">
              <span className="badge badge-success">Ready</span>
              <span>
                Lumen has your account for <strong>{row.email}</strong>.
              </span>
            </p>
          ) : (
            <p role="status" className="row">
              <span className="badge badge-warning">Setting up</span>
              <span>We&apos;re setting up your account. This takes a moment.</span>
              <AutoRefresh />
            </p>
          )}
        </div>
        <div className="card-footer row">
          <Link className="btn btn-secondary btn-sm" href="/profile">
            View profile
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/organization">
            Your organization
          </Link>
        </div>
      </section>
    </>
  )
}
