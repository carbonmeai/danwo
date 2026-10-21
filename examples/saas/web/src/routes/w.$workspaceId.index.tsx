/**
 * The workspace's notes: write one, publish it (to everyone here, live, and to Slack), and see the
 * notes your teammates publish the moment they do.
 */
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { z } from "zod"

import { Shell } from "../components/shell"
import { Badge, Empty, Notice, PageHeader } from "../components/ui"
import { useLiveNotes } from "../lib/realtime"
import { getRealtimeConfig, listNotes, publishNote, writeNote } from "../lib/server"
import type { Note } from "../lib/types"

const workspaceRoute = getRouteApi("/w/$workspaceId")

export const Route = createFileRoute("/w/$workspaceId/")({
  validateSearch: z.object({ welcome: z.number().optional() }),
  loader: async ({ params }) => {
    const [{ notes }, realtime] = await Promise.all([
      listNotes({ data: { id: params.workspaceId } }),
      getRealtimeConfig(),
    ])

    return { notes, realtime }
  },
  component: NotesPage,
})

/** Notes newest first, with each id once: a live update can repeat one the page has. */
function merged(notes: readonly Note[], note: Note): Note[] {
  return [note, ...notes.filter((other) => other.id !== note.id)].toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

function Composer({
  workspaceId,
  onSaved,
}: {
  readonly workspaceId: string
  readonly onSaved: (note: Note) => void
}) {
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const fields = new FormData(form)

    setBusy(true)
    setError(undefined)

    const saved = await writeNote({
      data: {
        id: workspaceId,
        title: String(fields.get("title") ?? ""),
        body: String(fields.get("body") ?? ""),
        publish: fields.get("publish") === "on",
        requestKey,
      },
    })

    setBusy(false)
    if (!saved.ok) return setError(saved.error)

    form.reset()
    setRequestKey(crypto.randomUUID())
    onSaved(saved.data.note)
  }

  return (
    <section className="card" aria-labelledby="new-note">
      <div className="card-header">
        <h2 id="new-note" className="card-title">
          New note
        </h2>
      </div>
      <form className="card-body stack" onSubmit={submit}>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="field">
          <label className="label" htmlFor="title">
            Title
          </label>
          <input id="title" name="title" className="input" required maxLength={120} />
        </div>
        <div className="field">
          <label className="label" htmlFor="body">
            Note
          </label>
          <textarea id="body" name="body" className="input min-h-24 py-2" rows={4} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="publish" defaultChecked />
            Publish to the team now
          </label>
          <button className="btn btn-primary" type="submit" aria-busy={busy} disabled={busy}>
            Save note
          </button>
        </div>
      </form>
    </section>
  )
}

function NoteCard({
  note,
  workspaceId,
  onPublished,
}: {
  readonly note: Note
  readonly workspaceId: string
  readonly onPublished: (note: Note) => void
}) {
  const [busy, setBusy] = useState(false)

  async function publish() {
    setBusy(true)

    const published = await publishNote({ data: { id: workspaceId, noteId: note.id } })

    setBusy(false)
    if (published.ok) onPublished(published.data.note)
  }

  return (
    <article className="card" aria-label={note.title}>
      <div className="card-body flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold">
            <a href={`/w/${workspaceId}/notes/${note.id}`} className="hover:underline">
              {note.title}
            </a>
          </h3>
          {note.publishedAt ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>}
        </div>
        {note.body && <p className="whitespace-pre-line text-sm text-muted">{note.body}</p>}
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>{note.author ?? note.authorEmail}</span>
          {!note.publishedAt && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={publish}
              aria-busy={busy}
              disabled={busy}
            >
              Publish
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

function NotesPage() {
  const { session, current } = workspaceRoute.useLoaderData()
  const { notes: loaded, realtime } = Route.useLoaderData()
  const { welcome } = Route.useSearch()
  const [notes, setNotes] = useState<Note[]>([...loaded])
  const [heard, setHeard] = useState<string>()
  const workspaceId = current.workspace.id

  useLiveNotes(realtime, workspaceId, (note) => {
    setNotes((shown) => merged(shown, note))
    if (note.authorEmail !== session.me.email)
      setHeard(`${note.author ?? note.authorEmail} published “${note.title}”`)
  })

  const keep = (note: Note) => setNotes((shown) => merged(shown, note))

  return (
    <Shell session={session} current={current} title="Notes">
      <PageHeader
        title="Notes"
        description="Updates, decisions and plans, shared with the whole team."
      />
      <div className="stack">
        {welcome !== undefined && current.workspace.ready && (
          <Notice tone="success" title={`${current.workspace.name} is ready`}>
            Your 14-day trial of the Team plan has started. Invite a teammate and connect Slack
            next.
          </Notice>
        )}
        {heard && (
          <div role="status" className="toast toast-floating toast-success">
            <p className="toast-text">{heard}</p>
          </div>
        )}
        <Composer workspaceId={workspaceId} onSaved={keep} />
        <section className="stack" aria-label="All notes">
          {notes.length === 0 ? (
            <Empty title="No notes yet">Write the first one above.</Empty>
          ) : (
            notes.map((note) => (
              <NoteCard key={note.id} note={note} workspaceId={workspaceId} onPublished={keep} />
            ))
          )}
        </section>
      </div>
    </Shell>
  )
}
