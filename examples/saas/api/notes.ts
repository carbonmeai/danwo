/**
 * Notes: written as drafts, then published to the workspace. Publishing marks the note and queues
 * its Slack post in one transaction, so a note is posted once however often the button is pressed
 * or the request retried; then it goes out live to everyone with the workspace open.
 */
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { query, transaction, type Transaction } from "../shared/db/client.ts"
import { notes, users } from "../shared/db/schema.ts"
import { notePublished } from "../shared/events.ts"
import { enqueue, flushSoon } from "../shared/outbox.ts"
import { HttpError } from "./problems.ts"
import { broadcast } from "./realtime.ts"
import { membershipOf, type SignedIn, signedIn } from "./session.ts"
import { WorkspaceId } from "./workspaces.ts"

const NewNote = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(10_000),
  publish: z.boolean().default(false),
  /** The form's own key, so a doubled or retried submit saves one note. */
  requestKey: z.string().min(8).max(100),
})

/** What the pages show of a note. */
const NOTE_FIELDS = {
  id: notes.id,
  title: notes.title,
  body: notes.body,
  publishedAt: notes.publishedAt,
  createdAt: notes.createdAt,
  author: users.name,
  authorEmail: users.email,
}

/** A note as the pages show it. */
async function noteView(id: number) {
  const [note] = await query("read note", (db) =>
    db
      .select(NOTE_FIELDS)
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorId))
      .where(eq(notes.id, id)),
  )

  if (!note) throw new HttpError(404, "No such note.")

  return note
}

/**
 * Marks note `id` published unless it is already, and queues its Slack post. The job is named
 * after the note's request key, which no other note anywhere shares.
 */
async function markPublished(tx: Transaction, id: number): Promise<void> {
  const [published] = await tx
    .update(notes)
    .set({ publishedAt: new Date() })
    .where(and(eq(notes.id, id), isNull(notes.publishedAt)))
    .returning({ id: notes.id, key: notes.requestKey })

  if (published)
    await enqueue(tx, {
      id: `note-${published.key}-published`,
      name: notePublished.name,
      data: { noteId: id },
    })
}

/**
 * The note, once its publish committed: the Slack job goes out, and so does the live update. It
 * runs for a note an earlier attempt published too, whose COMMIT landed with its answer lost: the
 * job's id makes a second send a no-op, and the page ignores an update it has seen.
 */
async function announced(workspaceId: string, id: number) {
  const note = await noteView(id)

  if (note.publishedAt) {
    await flushSoon()
    await broadcast(workspaceId, "note.published", note)
  }

  return note
}

export const notesApi = new Hono<SignedIn>()
  .use(signedIn)
  .get("/workspaces/:id/notes", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const rows = await query("list notes", (db) =>
      db
        .select(NOTE_FIELDS)
        .from(notes)
        .innerJoin(users, eq(users.id, notes.authorId))
        .where(eq(notes.workspaceId, workspace.id))
        .orderBy(desc(notes.createdAt)),
    )

    return c.json({ notes: rows })
  })
  .post("/workspaces/:id/notes", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const input = NewNote.parse(await c.req.json())
    const id = await transaction("write note", async (tx) => {
      await tx
        .insert(notes)
        .values({
          workspaceId: workspace.id,
          authorId: c.var.userId,
          requestKey: input.requestKey,
          title: input.title,
          body: input.body,
        })
        .onConflictDoNothing({ target: notes.requestKey })

      /* This submit's note, or the one an earlier submit of the same form saved. */
      const [note] = await tx
        .select({ id: notes.id, workspaceId: notes.workspaceId })
        .from(notes)
        .where(eq(notes.requestKey, input.requestKey))

      if (!note || note.workspaceId !== workspace.id)
        throw new HttpError(409, "Reload the page and try again.")
      if (input.publish) await markPublished(tx, note.id)

      return note.id
    })

    return c.json({ note: await announced(workspace.id, id) }, 201)
  })
  .post("/workspaces/:id/notes/:note/publish", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const id = z.coerce.number().int().parse(c.req.param("note"))
    const [mine] = await query("find note", (db) =>
      db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.workspaceId, workspace.id))),
    )

    if (!mine) throw new HttpError(404, "No such note.")

    await transaction("publish note", (tx) => markPublished(tx, id))

    return c.json({ note: await announced(workspace.id, id) })
  })
