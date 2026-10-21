import { auth } from "@clerk/nextjs/server"
import Link from "next/link"

import { once } from "../../../lib/clerk.ts"
import { organizationsOf, organizationView } from "../../../lib/organizations.ts"
import { AutoRefresh } from "../auto-refresh.tsx"
import { CreateOrganizationForm, InviteForm } from "./forms.tsx"

export const dynamic = "force-dynamic"

/** What the page shows while Clerk can't be reached: a note, and another look in a second. */
function Unreachable() {
  return (
    <section className="card">
      <div className="card-body empty" role="status">
        <p className="empty-title">Loading your organization</p>
        <p className="empty-text">Clerk didn&apos;t answer just now. Trying again…</p>
        <AutoRefresh />
      </div>
    </section>
  )
}

/** A role as people read it. */
function roleName(role: string): string {
  return role === "org:admin" ? "Admin" : "Member"
}

/**
 * The signed-in person's organization: who is in it (as Clerk has it, and whether the app's own
 * database has caught up), who is invited, and a form to invite someone else. `?org=` picks one
 * of their organizations; without it, the active one, else their first.
 */
export default async function OrganizationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly org?: string }>
}) {
  const { userId, orgId } = await auth.protect()
  const { org } = await searchParams
  const organizations = await organizationsOf(userId, once).catch(() => undefined)

  if (organizations === undefined) return <Unreachable />

  const chosen =
    organizations.find((o) => o.id === org) ??
    organizations.find((o) => o.id === orgId) ??
    organizations[0]

  if (chosen === undefined)
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">Organization</h1>
          <p className="page-description">Bring your team into Lumen.</p>
        </header>
        <section className="card">
          <div className="card-body empty">
            <p className="empty-title">No organization yet</p>
            <p className="empty-text">Create one, then invite the people you work with.</p>
            <div className="w-full max-w-sm text-left">
              <CreateOrganizationForm />
            </div>
          </div>
        </section>
      </>
    )

  const view = await organizationView(userId, chosen.id, once).catch(() => null)

  if (view === null) return <Unreachable />
  if (view === undefined) return <p className="muted">That organization is not yours.</p>

  const admin = view.role === "org:admin"

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">{view.name}</h1>
        <p className="page-description">
          {view.members.length} {view.members.length === 1 ? "member" : "members"} · you are{" "}
          {roleName(view.role).toLowerCase()}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card self-start" aria-labelledby="members-title">
          <div className="card-header">
            <h2 className="card-title" id="members-title">
              Members
            </h2>
            <p className="card-description">
              From Clerk; &ldquo;In Lumen&rdquo; once the app&apos;s own records have them.
            </p>
          </div>
          <div className="table-wrap">
            <table className="table" aria-label="Members">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>In Lumen</th>
                </tr>
              </thead>
              <tbody>
                {view.members.map((member) => (
                  <tr key={member.userId}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>{roleName(member.role)}</td>
                    <td>
                      <span
                        className={member.inApp ? "badge badge-success" : "badge badge-warning"}
                      >
                        {member.inApp ? "Yes" : "Not yet"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="stack">
          {admin && (
            <section className="card" aria-labelledby="invite-title">
              <div className="card-header">
                <h2 className="card-title" id="invite-title">
                  Invite someone
                </h2>
                <p className="card-description">Clerk emails them a link to join.</p>
              </div>
              <div className="card-body">
                <InviteForm organization={view.id} />
              </div>
            </section>
          )}

          {view.invitations.length > 0 && (
            <section className="card" aria-labelledby="pending-title">
              <div className="card-header">
                <h2 className="card-title" id="pending-title">
                  Invited
                </h2>
              </div>
              <ul className="card-body stack" aria-label="Pending invitations">
                {view.invitations.map((invitation) => (
                  <li key={invitation.id} className="row">
                    <span>{invitation.email}</span>
                    <span className="badge badge-info">Pending</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="yours-title">
            <div className="card-header">
              <h2 className="card-title" id="yours-title">
                Your organizations
              </h2>
            </div>
            <div className="card-body stack">
              <nav className="stack" aria-label="Your organizations">
                {organizations.map((o) => (
                  <Link
                    key={o.id}
                    href={`/organization?org=${o.id}`}
                    aria-current={o.id === view.id ? "page" : undefined}
                  >
                    {o.name}
                  </Link>
                ))}
              </nav>
              <CreateOrganizationForm />
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
