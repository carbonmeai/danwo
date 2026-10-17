import { randomInt } from "node:crypto"

import type { gmail_v1 } from "googleapis"

import type { Context } from "../../http.ts"
import { jsonBody, notFound, pageOf, pageSize } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import type { GmailDraftRecord } from "../entities.ts"
import { formatOf, messageRef, messageResource } from "../gmail-format.ts"
import { addMessage, deleteMessage, mailboxOwner, messageOf, sendMessage } from "../gmail.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"
import { rawMessage } from "./gmail-messages.ts"

const USER = "/gmail/v1/users/:userId"
const UPLOAD = "/upload/gmail/v1/users/:userId"

/** A draft id: `r` and digits, like Gmail's. */
function draftId(): string {
  return `r${Array.from({ length: 19 }, () => randomInt(10)).join("")}`
}

function draftOf(context: GoogleRouteContext, owner: string, id: string): GmailDraftRecord {
  const found = googleStore(context.store).drafts.findOneBy("draftId", id)

  if (!found || found.owner !== owner) throw notFound()

  return found
}

/** Drafts: create, list, get, update, delete and send. */
export function gmailDraftRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const drafts = () => googleStore(context.store).drafts

  const resource = (draft: GmailDraftRecord, format: Parameters<typeof messageResource>[1]) => ({
    id: draft.draftId,
    message: messageResource(messageOf(context, draft.owner, draft.messageId), format),
  })

  const create = async (c: Context) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailCompose)
    const { raw, body } = await rawMessage(c)
    const message = addMessage(context, caller.user.uid, raw, {
      labelIds: ["DRAFT"],
      threadId: typeof body.threadId === "string" ? body.threadId : null,
    })
    const draft = drafts().insert({
      draftId: draftId(),
      owner: caller.user.uid,
      messageId: message.messageId,
    })

    return c.json(resource(draft, "minimal") satisfies gmail_v1.Schema$Draft)
  }

  app.post(`${USER}/drafts`, create)
  app.post(`${UPLOAD}/drafts`, create)

  app.get(`${USER}/drafts`, (c) => {
    const caller = mailboxOwner(c, context, [...SCOPES.gmailRead, ...SCOPES.gmailCompose])
    const found = drafts()
      .all()
      .filter((draft) => draft.owner === caller.user.uid)
      .toReversed()
    const page = pageOf(found, c.req.query("pageToken"), pageSize(c, "maxResults", 100, 500))

    return c.json({
      ...(page.items.length > 0 && {
        drafts: page.items.map((draft) => ({
          id: draft.draftId,
          message: messageRef(messageOf(context, draft.owner, draft.messageId)),
        })),
      }),
      ...(page.next && { nextPageToken: page.next }),
      resultSizeEstimate: found.length,
    } satisfies gmail_v1.Schema$ListDraftsResponse)
  })

  app.get(`${USER}/drafts/:id`, (c) => {
    const caller = mailboxOwner(c, context, [...SCOPES.gmailRead, ...SCOPES.gmailCompose])

    return c.json(
      resource(
        draftOf(context, caller.user.uid, c.req.param("id")),
        formatOf(c.req.query("format")),
      ),
    )
  })

  const update = async (c: Context) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailCompose)
    const draft = draftOf(context, caller.user.uid, c.req.param("id"))
    const { raw, body } = await rawMessage(c)
    const old = messageOf(context, caller.user.uid, draft.messageId)
    const message = addMessage(context, caller.user.uid, raw, {
      labelIds: ["DRAFT"],
      threadId: typeof body.threadId === "string" ? body.threadId : old.threadId,
    })

    deleteMessage(context, old)
    drafts().insert({ draftId: draft.draftId, owner: draft.owner, messageId: message.messageId })

    return c.json(resource(draftOf(context, caller.user.uid, draft.draftId), "minimal"))
  }

  app.put(`${USER}/drafts/:id`, update)
  app.put(`${UPLOAD}/drafts/:id`, update)

  app.delete(`${USER}/drafts/:id`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailCompose)
    const draft = draftOf(context, caller.user.uid, c.req.param("id"))

    deleteMessage(context, messageOf(context, caller.user.uid, draft.messageId))

    return c.body(null, 204)
  })

  const send = async (c: Context) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailCompose)
    const { id } = await jsonBody(c)
    const draft = draftOf(context, caller.user.uid, typeof id === "string" ? id : "")
    const message = messageOf(context, caller.user.uid, draft.messageId)

    deleteMessage(context, message)

    return c.json(
      messageResource(sendMessage(context, caller.user, message.raw, message.threadId), "minimal"),
    )
  }

  app.post(`${USER}/drafts/send`, send)
}
