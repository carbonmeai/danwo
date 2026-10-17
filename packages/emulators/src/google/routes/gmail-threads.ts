import type { gmail_v1 } from "googleapis"

import type { Context } from "../../http.ts"
import { jsonBody, notFound, pageOf, pageSize, queryAll } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import type { GmailMessageRecord } from "../entities.ts"
import { formatOf, messageResource, snippetOf } from "../gmail-format.ts"
import { changeLabels, deleteMessage, mailboxOwner } from "../gmail.ts"
import { parseMime } from "../mime.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"
import { labelList, listedMessages } from "./gmail-messages.ts"

const THREADS = "/gmail/v1/users/:userId/threads"

/** A thread's messages, oldest first, or a 404. */
function threadMessages(
  context: GoogleRouteContext,
  owner: string,
  threadId: string,
): GmailMessageRecord[] {
  const messages = googleStore(context.store)
    .messages.findBy("owner", owner)
    .filter((message) => message.threadId === threadId)
    .toSorted((a, b) => a.internalDate - b.internalDate)

  if (messages.length === 0) throw notFound()

  return messages
}

function latestHistoryId(messages: readonly GmailMessageRecord[]): string {
  return String(Math.max(...messages.map((message) => message.historyId)))
}

/** Threads: list, get, modify, trash, untrash and delete. */
export function gmailThreadRoutes(context: GoogleRouteContext): void {
  const { app } = context

  app.get(THREADS, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailRead)
    const threads = new Map<string, GmailMessageRecord>()

    for (const message of listedMessages(c, context, caller.user.uid))
      if (!threads.has(message.threadId)) threads.set(message.threadId, message)

    const found = [...threads.values()]
    const page = pageOf(found, c.req.query("pageToken"), pageSize(c, "maxResults", 100, 500))

    return c.json({
      ...(page.items.length > 0 && {
        threads: page.items.map((message) => ({
          id: message.threadId,
          snippet: snippetOf(parseMime(message.raw)),
          historyId: String(message.historyId),
        })),
      }),
      ...(page.next && { nextPageToken: page.next }),
      resultSizeEstimate: found.length,
    } satisfies gmail_v1.Schema$ListThreadsResponse)
  })

  app.get(`${THREADS}/:id`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailRead)
    const messages = threadMessages(context, caller.user.uid, c.req.param("id"))
    const format = formatOf(c.req.query("format"))

    return c.json({
      id: c.req.param("id"),
      historyId: latestHistoryId(messages),
      messages: messages.map((message) =>
        messageResource(message, format, queryAll(c, "metadataHeaders")),
      ),
    } satisfies gmail_v1.Schema$Thread)
  })

  const relabel = (c: Context, add: readonly string[], remove: readonly string[]) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailModify)
    const messages = threadMessages(context, caller.user.uid, c.req.param("id")).map((message) =>
      changeLabels(context, message, add, remove),
    )

    return c.json({
      id: c.req.param("id"),
      historyId: latestHistoryId(messages),
      messages: messages.map((message) => messageResource(message, "minimal")),
    } satisfies gmail_v1.Schema$Thread)
  }

  app.post(`${THREADS}/:id/modify`, async (c) => {
    const body = await jsonBody(c)

    return relabel(c, labelList(body.addLabelIds), labelList(body.removeLabelIds))
  })
  app.post(`${THREADS}/:id/trash`, (c) => relabel(c, ["TRASH"], []))
  app.post(`${THREADS}/:id/untrash`, (c) => relabel(c, [], ["TRASH"]))

  app.delete(`${THREADS}/:id`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailDelete)

    for (const message of threadMessages(context, caller.user.uid, c.req.param("id")))
      deleteMessage(context, message)

    return c.body(null, 204)
  })
}
