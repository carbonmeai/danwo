import { query } from "../../lib/db.ts"
import { Topbar } from "../topbar.tsx"

export const dynamic = "force-dynamic"

interface Signup {
  readonly id: string
  readonly email: string
  readonly created_at: Date
  readonly welcomed: boolean
}

const JOINED = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

/** The latest signups, newest first, and whether each was welcomed. */
export default async function SignupsPage() {
  const signups = await query<Signup>(
    `select id::text, email, created_at, welcomed_at is not null as welcomed
     from signups order by created_at desc, id desc limit 50`,
  ).catch(() => undefined)

  return (
    <>
      <Topbar page="Signups" />
      <main className="shell-content">
        <header className="page-header">
          <h1 className="page-title">Signups</h1>
          <p className="page-description">Everyone on the waitlist, newest first.</p>
        </header>
        {signups === undefined ? (
          <div className="empty" role="alert">
            <p className="empty-title">Signups are unavailable</p>
            <p className="empty-text">The database didn&apos;t answer. Reload in a moment.</p>
          </div>
        ) : signups.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No signups yet</p>
            <p className="empty-text">People who join the waitlist show up here.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Welcome email</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((signup) => (
                  <tr key={signup.id}>
                    <td>{signup.email}</td>
                    <td className="text-muted">{JOINED.format(signup.created_at)}</td>
                    <td>
                      {signup.welcomed ? (
                        <span className="badge badge-success">Sent</span>
                      ) : (
                        <span className="badge badge-warning">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
