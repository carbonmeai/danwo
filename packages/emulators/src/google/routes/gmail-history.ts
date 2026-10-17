import type { gmail_v1 } from "googleapis"

import { badRequest, jsonBody, notFound, pageOf, pageSize, queryAll } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import type { GmailHistoryRecord } from "../entities.ts"
import { mailboxOf, mailboxOwner } from "../gmail.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"
import { labelList } from "./gmail-messages.ts"

const USER = "/gmail/v1/users/:userId"

/** Seven days, how long a Gmail watch lasts before it must be renewed. */
const WATCH_MS = 7 * 24 * 60 * 60 * 1000

const TOPIC = /^projects\/[^/]+\/topics\/[^/]+$/

/** One history entry's fields for a single recorded change. */
function changeEntry(record: GmailHistoryRecord): gmail_v1.Schema$History {
  const message = { id: record.messageId, threadId: record.threadId }

  switch (record.change) {
    case "messageAdded":
      return { messagesAdded: [{ message: { ...message, labelIds: record.labelIds } }] }
    case "messageDeleted":
      return { messagesDeleted: [{ message }] }
    case "labelAdded":
      return { labelsAdded: [{ message, labelIds: record.labelIds }] }
    default:
      return { labelsRemoved: [{ message, labelIds: record.labelIds }] }
  }
}

function historyEntry(record: GmailHistoryRecord): gmail_v1.Schema$History {
  return {
    id: String(record.historyId),
    messages: [{ id: record.messageId, threadId: record.threadId }],
    ...changeEntry(record),
  }
}

/** Whether a record passes the `historyTypes` and `labelId` filters. */
function wanted(record: GmailHistoryRecord, types: readonly string[], labelId: string | undefined) {
  const typeOk = types.length === 0 || types.includes(record.change)

  return typeOk && (labelId === undefined || record.labelIds.includes(labelId))
}

/** History since a start id, and users.watch / users.stop for Pub/Sub push. */
export function gmailHistoryRoutes(context: GoogleRouteContext): void {
  const { app, clock } = context
  const google = () => googleStore(context.store)

  app.get(`${USER}/history`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailWatch)
    const mailbox = mailboxOf(context, caller.user.uid)
    const start = Number(c.req.query("startHistoryId"))

    if (!Number.isFinite(start) || c.req.query("startHistoryId") === undefined)
      throw badRequest("Invalid startHistoryId", "invalidArgument")
    if (start < mailbox.floor) throw notFound()

    const types = queryAll(c, "historyTypes")
    const labelId = c.req.query("labelId")
    const records = google()
      .history.findBy("owner", caller.user.uid)
      .filter((record) => record.historyId > start && wanted(record, types, labelId))
    const page = pageOf(records, c.req.query("pageToken"), pageSize(c, "maxResults", 100, 500))

    return c.json({
      ...(page.items.length > 0 && { history: page.items.map(historyEntry) }),
      ...(page.next && { nextPageToken: page.next }),
      historyId: String(mailbox.historyId),
    } satisfies gmail_v1.Schema$ListHistoryResponse)
  })

  app.post(`${USER}/watch`, async (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailWatch)
    const body = await jsonBody(c)
    const topicName = typeof body.topicName === "string" ? body.topicName : ""

    if (!TOPIC.test(topicName))
      throw badRequest(
        "Invalid topicName does not match projects/SOME-PROJECT/topics/SOME-TOPIC",
        "invalidArgument",
      )

    const mailbox = mailboxOf(context, caller.user.uid)
    const behavior = body.labelFilterBehavior ?? body.labelFilterAction
    const expiration = clock().getTime() + WATCH_MS

    google().mailboxes.update(mailbox.id, {
      watch: {
        topicName,
        labelIds: labelList(body.labelIds),
        labelFilterBehavior: behavior === "exclude" ? "exclude" : "include",
        expiration,
      },
    })

    return c.json({
      historyId: String(mailbox.historyId),
      expiration: String(expiration),
    } satisfies gmail_v1.Schema$WatchResponse)
  })

  app.post(`${USER}/stop`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailWatch)

    google().mailboxes.update(mailboxOf(context, caller.user.uid).id, { watch: null })

    return c.body(null, 204)
  })
}
