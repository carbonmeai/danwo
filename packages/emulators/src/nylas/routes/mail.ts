/** Messages, threads, drafts, folders and attachments of a grant's mailbox. */
import type { Context } from "../../http.ts"
import { grantOf } from "../auth.ts"
import type { NylasDraft, NylasFolder, NylasMessage } from "../entities.ts"
import {
  bodyOf,
  hexId,
  type NylasRouteContext,
  notFound,
  one,
  page,
  people,
  requestId,
  seconds,
  snippetOf,
  text,
} from "../helpers.ts"
import { messageInput, refreshThread, sendMessage } from "../mail.ts"

const GRANT = "/v3/grants/:grant"

type Filter = (message: NylasMessage) => boolean

const hasEmail = (list: readonly { email: string }[], email: string) =>
  list.some((person) => person.email.toLowerCase() === email.toLowerCase())

/** The filters a messages list asked for, from its query. */
function filtersOf(c: Context): Filter[] {
  const q = (name: string) => c.req.query(name)
  const filters: (Filter | undefined)[] = [
    q("subject") !== undefined ? (m) => m.subject === q("subject") : undefined,
    q("from") !== undefined ? (m) => hasEmail(m.from, q("from") ?? "") : undefined,
    q("to") !== undefined ? (m) => hasEmail(m.to, q("to") ?? "") : undefined,
    q("any_email") !== undefined
      ? (m) =>
          (q("any_email") ?? "")
            .split(",")
            .some((email) => hasEmail([...m.from, ...m.to, ...m.cc, ...m.bcc], email))
      : undefined,
    q("in") !== undefined ? (m) => m.folders.includes(q("in") ?? "") : undefined,
    q("thread_id") !== undefined ? (m) => m.thread_id === q("thread_id") : undefined,
    q("unread") !== undefined ? (m) => m.unread === (q("unread") === "true") : undefined,
    q("starred") !== undefined ? (m) => m.starred === (q("starred") === "true") : undefined,
    q("received_after") !== undefined ? (m) => m.date > Number(q("received_after")) : undefined,
    q("received_before") !== undefined ? (m) => m.date < Number(q("received_before")) : undefined,
  ]

  return filters.filter((filter) => filter !== undefined)
}

/** Newest first, as Nylas lists them. */
const newestFirst = <T extends { date: number }>(items: T[]) => items.toReversed()

function messageOf(context: NylasRouteContext, c: Context): NylasMessage {
  const grant = grantOf(context, c)
  const message = context.objects.messages.get(c.req.param("id"))

  if (!message || message.grant_id !== grant.id) throw notFound(`message ${c.req.param("id")}`)

  return message
}

/** The fields a message or thread update may change. */
function flagsOf(body: Readonly<Record<string, unknown>>) {
  return {
    ...(typeof body["unread"] === "boolean" && { unread: body["unread"] }),
    ...(typeof body["starred"] === "boolean" && { starred: body["starred"] }),
    ...(Array.isArray(body["folders"]) && {
      folders: body["folders"].filter((f): f is string => typeof f === "string"),
    }),
  }
}

function messageRoutes(context: NylasRouteContext): void {
  const { app, objects, events } = context

  app.get(`${GRANT}/messages`, (c) => {
    const grant = grantOf(context, c)
    const filters = filtersOf(c)

    return page(
      c,
      newestFirst(
        objects.messages.where((m) => m.grant_id === grant.id && filters.every((f) => f(m))),
      ),
    )
  })
  app.get(`${GRANT}/messages/:id`, (c) => one(c, messageOf(context, c)))
  app.put(`${GRANT}/messages/:id`, async (c) => {
    const message = messageOf(context, c)
    const changed = objects.messages.change(message.id, flagsOf(await bodyOf(c))) ?? message

    refreshThread(context, message.thread_id)
    events.emit("message.updated", grantOf(context, c), changed)

    return one(c, changed)
  })
  app.delete(`${GRANT}/messages/:id`, (c) => {
    const message = messageOf(context, c)

    objects.messages.change(message.id, { folders: ["TRASH"] })
    refreshThread(context, message.thread_id)

    return c.json({ request_id: requestId() })
  })
  app.post(`${GRANT}/messages/send`, async (c) => {
    const grant = grantOf(context, c)
    const body = await bodyOf(c)
    const replyId = text(body, "reply_to_message_id")
    const replyTo = replyId === undefined ? undefined : objects.messages.get(replyId)

    return one(c, sendMessage(context, grant, messageInput(grant, body), replyTo))
  })
}

function threadRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  const threadOf = (c: Context) => {
    const grant = grantOf(context, c)
    const thread = objects.threads.get(c.req.param("id"))

    if (!thread || thread.grant_id !== grant.id) throw notFound(`thread ${c.req.param("id")}`)

    return thread
  }

  app.get(`${GRANT}/threads`, (c) => {
    const grant = grantOf(context, c)
    const folder = c.req.query("in")
    const threads = objects.threads.where(
      (t) => t.grant_id === grant.id && (folder === undefined || t.folders.includes(folder)),
    )

    return page(c, threads.toReversed())
  })
  app.get(`${GRANT}/threads/:id`, (c) => one(c, threadOf(c)))
  app.put(`${GRANT}/threads/:id`, async (c) => {
    const thread = threadOf(c)
    const flags = flagsOf(await bodyOf(c))

    for (const id of thread.message_ids) objects.messages.change(id, flags)
    refreshThread(context, thread.id)

    return one(c, objects.threads.get(thread.id))
  })
  app.delete(`${GRANT}/threads/:id`, (c) => {
    const thread = threadOf(c)

    for (const id of thread.message_ids) objects.messages.change(id, { folders: ["TRASH"] })
    refreshThread(context, thread.id)

    return c.json({ request_id: requestId() })
  })
}

function draftRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  const draftOf = (c: Context): NylasDraft => {
    const grant = grantOf(context, c)
    const draft = objects.drafts.get(c.req.param("id"))

    if (!draft || draft.grant_id !== grant.id) throw notFound(`draft ${c.req.param("id")}`)

    return draft
  }

  app.get(`${GRANT}/drafts`, (c) => {
    const grant = grantOf(context, c)

    return page(c, objects.drafts.where((d) => d.grant_id === grant.id).toReversed())
  })
  app.get(`${GRANT}/drafts/:id`, (c) => one(c, draftOf(c)))
  app.post(`${GRANT}/drafts`, async (c) => {
    const grant = grantOf(context, c)
    const body = await bodyOf(c)
    const now = seconds(context.clock)
    const draft: NylasDraft = {
      id: hexId(),
      grant_id: grant.id,
      object: "draft",
      thread_id: hexId(),
      subject: text(body, "subject") ?? "",
      body: text(body, "body") ?? "",
      snippet: snippetOf(text(body, "body") ?? ""),
      from: [{ email: grant.email }],
      to: [],
      cc: [],
      bcc: [],
      reply_to: [],
      date: now,
      unread: false,
      starred: false,
      folders: ["DRAFT"],
      attachments: [],
      metadata: {},
      created_at: now,
    }
    const input = { ...draft, ...draftFields(body) }

    return one(c, objects.drafts.add(input, null))
  })
  app.put(`${GRANT}/drafts/:id`, async (c) => {
    const draft = draftOf(c)

    return one(c, objects.drafts.change(draft.id, draftFields(await bodyOf(c))))
  })
  app.delete(`${GRANT}/drafts/:id`, (c) => {
    objects.drafts.remove(draftOf(c).id)

    return c.json({ request_id: requestId() })
  })
  app.post(`${GRANT}/drafts/:id`, (c) => {
    const draft = draftOf(c)
    const grant = grantOf(context, c)
    const sent = sendMessage(context, grant, messageInput(grant, { ...draft }))

    objects.drafts.remove(draft.id)

    return one(c, sent)
  })
}

/** The fields a draft takes from a create or update body. */
function draftFields(body: Readonly<Record<string, unknown>>): Partial<NylasDraft> {
  const subject = text(body, "subject")
  const content = text(body, "body")
  const lists = (["to", "cc", "bcc", "reply_to"] as const).flatMap((key) =>
    Array.isArray(body[key]) ? [[key, people(body[key])] as const] : [],
  )

  return {
    ...(subject !== undefined && { subject }),
    ...(content !== undefined && { body: content, snippet: snippetOf(content) }),
    ...Object.fromEntries(lists),
  }
}

function folderRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  const folderOf = (c: Context): NylasFolder => {
    const grant = grantOf(context, c)
    const folder = objects.folders.where(
      (f) => f.grant_id === grant.id && f.id === c.req.param("id"),
    )[0]

    if (!folder) throw notFound(`folder ${c.req.param("id")}`)

    return folder
  }

  const counted = (folder: NylasFolder): NylasFolder => {
    const inside = objects.messages.where(
      (m) => m.grant_id === folder.grant_id && m.folders.includes(folder.id),
    )

    return {
      ...folder,
      total_count: inside.length,
      unread_count: inside.filter((m) => m.unread).length,
    }
  }

  app.get(`${GRANT}/folders`, (c) => {
    const grant = grantOf(context, c)

    return page(c, objects.folders.where((f) => f.grant_id === grant.id).map(counted))
  })
  app.get(`${GRANT}/folders/:id`, (c) => one(c, counted(folderOf(c))))
  app.post(`${GRANT}/folders`, async (c) => {
    const grant = grantOf(context, c)
    const body = await bodyOf(c)
    const folder: NylasFolder = {
      id: `Label_${objects.next()}`,
      grant_id: grant.id,
      object: "folder",
      name: text(body, "name") ?? "Untitled",
      system_folder: false,
      attributes: [],
      parent_id: text(body, "parent_id") ?? null,
      background_color: text(body, "background_color") ?? null,
      text_color: text(body, "text_color") ?? null,
      total_count: 0,
      unread_count: 0,
    }

    context.events.emit("folder.created", grant, folder)

    return one(c, objects.folders.add(folder, null))
  })
  app.delete(`${GRANT}/folders/:id`, (c) => {
    const folder = folderOf(c)

    objects.folders.remove(folder.id)

    return c.json({ request_id: requestId() })
  })
}

function attachmentRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  const fileOf = (c: Context) => {
    const grant = grantOf(context, c)
    const file = objects.files.get(c.req.param("id"))

    if (!file || file.grant_id !== grant.id) throw notFound(`attachment ${c.req.param("id")}`)

    const message = objects.messages.get(file.message_id)
    const meta = message?.attachments.find((a) => a.id === file.id)

    return { file, meta }
  }

  app.get(`${GRANT}/attachments/:id`, (c) => one(c, fileOf(c).meta))
  app.get(`${GRANT}/attachments/:id/download`, (c) => {
    const { file, meta } = fileOf(c)

    return c.body(Buffer.from(file.content, "base64"), 200, {
      "content-type": meta?.content_type ?? "application/octet-stream",
    })
  })
}

/** Every mailbox route. */
export function mailRoutes(context: NylasRouteContext): void {
  for (const register of [messageRoutes, threadRoutes, draftRoutes, folderRoutes, attachmentRoutes])
    register(context)
}
