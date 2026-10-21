/** Who is in the workspace, and inviting someone by email. */
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"

import { Badge, Notice } from "../components/ui"
import { inviteMember } from "../lib/server"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/settings/members")({ component: Members })

function InviteForm({ workspaceId }: { readonly workspaceId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string>()
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const form = event.currentTarget
    const email = String(new FormData(form).get("email") ?? "")

    setBusy(true)
    setSent(undefined)
    setError(undefined)

    const invited = await inviteMember({ data: { id: workspaceId, email } })

    setBusy(false)
    if (!invited.ok) return setError(invited.error)

    form.reset()
    setSent(invited.data.invited)
    await router.invalidate()
  }

  return (
    <form className="card-body stack" onSubmit={submit}>
      {sent && <Notice tone="success">Invitation sent to {sent}.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="field min-w-64 flex-1">
          <label className="label" htmlFor="invite-email">
            Email address
          </label>
          <input id="invite-email" name="email" type="email" className="input" required />
        </div>
        <button className="btn btn-primary" type="submit" aria-busy={busy} disabled={busy}>
          Send invite
        </button>
      </div>
    </form>
  )
}

function Members() {
  const { current } = workspaceRoute.useLoaderData()

  return (
    <div className="stack">
      {current.role === "org:admin" && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Invite a teammate</h2>
            <p className="card-description">They'll get an email with a link to join.</p>
          </div>
          <InviteForm workspaceId={current.workspace.id} />
        </section>
      )}
      <div className="table-wrap">
        <table className="table" aria-label="Members">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {current.members.map((member) => (
              <tr key={member.id}>
                <td>{member.name ?? "—"}</td>
                <td>{member.email}</td>
                <td>
                  <Badge tone={member.role === "org:admin" ? "info" : "neutral"}>
                    {member.role === "org:admin" ? "Admin" : "Member"}
                  </Badge>
                </td>
              </tr>
            ))}
            {current.invites.map((invite) => (
              <tr key={invite.email}>
                <td className="text-muted">Invited</td>
                <td>{invite.email}</td>
                <td>
                  <Badge tone="warning">Pending</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
