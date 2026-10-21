/** Every digest, newest first, with where its send has got to. */
import { listDigests } from "../api.ts"
import { when } from "../format.ts"
import { Link } from "../router.tsx"
import { Status, Topbar, usePolled } from "../ui.tsx"

const BUSY = new Set(["scheduled", "sending"])

export function DigestList() {
  const digests = usePolled(listDigests, {
    everyMs: 1_000,
    keepGoing: (list) => list.some((digest) => BUSY.has(digest.status)),
    version: "digests",
  })

  return (
    <>
      <Topbar
        trail={[{ label: "Digests" }]}
        action={
          <Link className="btn btn-primary btn-sm" to="/digests/new">
            New digest
          </Link>
        }
      />
      <main className="shell-content">
        <header className="page-header">
          <h1 className="page-title">Digests</h1>
          <p className="page-description">
            Write a digest, add who gets it, and schedule it. The background jobs send it on time,
            one email per subscriber, and bill the team for each one.
          </p>
        </header>
        {digests.state === "failed" && (
          <div className="toast toast-error" role="alert">
            {digests.error}
          </div>
        )}
        {digests.state === "ready" && digests.value.length === 0 && (
          <div className="empty">
            <p className="empty-title">No digests yet</p>
            <p className="empty-text">Your first one takes a minute to write.</p>
            <Link className="btn btn-primary" to="/digests/new">
              New digest
            </Link>
          </div>
        )}
        {digests.state === "ready" && digests.value.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Digest</th>
                  <th>Status</th>
                  <th>Sends</th>
                  <th className="num">Subscribers</th>
                  <th className="num">Sent</th>
                </tr>
              </thead>
              <tbody>
                {digests.value.map((digest) => (
                  <tr key={digest.id}>
                    <td>
                      <Link to={`/digests/${digest.id}`}>{digest.title}</Link>
                    </td>
                    <td>
                      <Status of={digest.status} />
                    </td>
                    <td className="muted">{when(digest.sendAt)}</td>
                    <td className="num">{digest.subscribers}</td>
                    <td className="num">{digest.sent}</td>
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
