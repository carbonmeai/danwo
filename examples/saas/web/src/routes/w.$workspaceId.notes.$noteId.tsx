/** One note, as its Slack message links to it, with a way to book a review in Google Calendar. */
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useState } from "react"

import { Shell } from "../components/shell"
import { Badge, Notice, PageHeader, shortDate } from "../components/ui"
import { listNotes, scheduleReview } from "../lib/server"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/notes/$noteId")({
  loader: async ({ params }) => {
    const { notes } = await listNotes({ data: { id: params.workspaceId } })
    const note = notes.find((one) => String(one.id) === params.noteId)

    if (!note) throw new Error("There's no such note in this workspace.")

    return { note }
  },
  component: NotePage,
})

function NotePage() {
  const { session, current } = workspaceRoute.useLoaderData()
  const { note } = Route.useLoaderData()
  const [busy, setBusy] = useState(false)
  const [booked, setBooked] = useState<string>()
  const [error, setError] = useState<string>()
  const calendar = current.integrations.find((one) => one.provider === "google")

  async function book() {
    setBusy(true)

    const made = await scheduleReview({ data: { id: current.workspace.id, noteId: note.id } })

    setBusy(false)
    if (made.ok) setBooked(made.data.event.start ? shortDate(made.data.event.start) : "tomorrow")
    else setError(made.error)
  }

  return (
    <Shell session={session} current={current} title={note.title}>
      <PageHeader title={note.title} description={`By ${note.author ?? note.authorEmail}`}>
        {note.publishedAt ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>}
      </PageHeader>
      <div className="stack">
        {booked && <Notice tone="success">Review booked in Google Calendar for {booked}.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <section className="card">
          <div className="card-body whitespace-pre-line">{note.body || "No text."}</div>
        </section>
        {calendar?.status === "connected" && (
          <div>
            <button className="btn btn-secondary" onClick={book} aria-busy={busy} disabled={busy}>
              Book a review in Google Calendar
            </button>
          </div>
        )}
      </div>
    </Shell>
  )
}
