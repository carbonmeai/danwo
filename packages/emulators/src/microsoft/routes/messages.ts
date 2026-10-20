import type { Context } from "../../http.ts"
import type { GraphCall } from "../access.ts"
import { userRoute } from "../access.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import type { MailFolderRecord, MessageRecord } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { jsonBody, text } from "../input.ts"
import {
  addMessage,
  copyFields,
  deleteMessage,
  findFolder,
  mailFolders,
  moveMessage,
  purgeMessage,
  updateMessage,
  wellKnownFolder,
} from "../mailbox.ts"
import { listResponse } from "../odata.ts"
import { attachmentObject, messageObject } from "../outlook-formatters.ts"
import { attachmentInput, appliedHeaders, messageInput, preferences } from "./mail-input.ts"

const GRAPH = "https://graph.microsoft.com/v1.0"

/** Graph's 404 for a message or folder that is not in the mailbox. */
export function itemNotFound(c: Context, context: MicrosoftRouteContext): Response {
  return graphError(c, context.clock, {
    status: 404,
    code: "ErrorItemNotFound",
    message: "The specified object was not found in the store.",
  })
}

export function findMessage(call: GraphCall, id: string): MessageRecord | undefined {
  const found = call.microsoft.messages.findOneBy("graphId", id)

  return found?.owner === call.user.oid ? found : undefined
}

/** The folder a path names by id or well-known name, or Graph's 404. */
export function folderParam(
  c: Context,
  context: MicrosoftRouteContext,
  call: GraphCall,
): MailFolderRecord | Response {
  return findFolder(context, call.user.oid, c.req.param("folder")) ?? itemNotFound(c, context)
}

/** Answers with one message, honouring the reader's `Prefer` choices. */
function messageResponse(c: Context, message: MessageRecord, status = 200): Response {
  return c.json(messageObject(message, preferences(c)), status, appliedHeaders(c))
}

function listMessages(c: Context, messages: readonly MessageRecord[]): Response {
  const prefs = preferences(c)

  return c.json(
    listResponse(
      c,
      messages.map((m) => messageObject(m, prefs)),
      { defaultOrder: "receivedDateTime desc", context: `${GRAPH}/$metadata#users('me')/messages` },
    ),
    200,
    appliedHeaders(c),
  )
}

/** Reading, writing, moving and deleting messages, mailbox-wide or within a folder. */
export function messageRoutes(context: MicrosoftRouteContext): void {
  const withMessage =
    (
      handler: (
        c: Context,
        call: GraphCall,
        message: MessageRecord,
      ) => Response | Promise<Response>,
    ) =>
    (c: Context, call: GraphCall) => {
      const message = findMessage(call, c.req.param("id"))

      return message ? handler(c, call, message) : itemNotFound(c, context)
    }

  userRoute(context, "get", "/messages", "Mail.Read", (c, call) => {
    mailFolders(context, call.user.oid)

    return listMessages(c, call.microsoft.messages.findBy("owner", call.user.oid))
  })

  userRoute(context, "get", "/mailFolders/:folder/messages", "Mail.Read", (c, call) => {
    const folder = folderParam(c, context, call)

    if (folder instanceof Response) return folder

    return listMessages(
      c,
      call.microsoft.messages
        .findBy("owner", call.user.oid)
        .filter((m) => m.folderId === folder.graphId),
    )
  })

  const create = async (c: Context, call: GraphCall, folder: MailFolderRecord) => {
    const fields = messageInput(await jsonBody(c))
    const message = addMessage(context, call.user.oid, folder.graphId, {
      isDraft: true,
      isRead: true,
      from: { name: call.user.name, address: call.user.email },
      ...fields,
    })

    return messageResponse(c, message, 201)
  }

  userRoute(context, "post", "/messages", "Mail.ReadWrite", (c, call) =>
    create(c, call, wellKnownFolder(context, call.user.oid, "drafts")),
  )

  userRoute(context, "post", "/mailFolders/:folder/messages", "Mail.ReadWrite", (c, call) => {
    const folder = folderParam(c, context, call)

    return folder instanceof Response ? folder : create(c, call, folder)
  })

  userRoute(
    context,
    "get",
    "/messages/:id",
    "Mail.Read",
    withMessage((c, _call, message) => messageResponse(c, message)),
  )
  userRoute(
    context,
    "get",
    "/mailFolders/:folder/messages/:id",
    "Mail.Read",
    withMessage((c, _call, message) => messageResponse(c, message)),
  )

  userRoute(
    context,
    "patch",
    "/messages/:id",
    "Mail.ReadWrite",
    withMessage(async (c, _call, message) => {
      const changes = messageInput(await jsonBody(c))

      return messageResponse(c, updateMessage(context, message, changes))
    }),
  )

  userRoute(
    context,
    "delete",
    "/messages/:id",
    "Mail.ReadWrite",
    withMessage((c, _call, message) => {
      deleteMessage(context, message)

      return c.body(null, 204)
    }),
  )

  userRoute(
    context,
    "post",
    "/messages/:id/permanentDelete",
    "Mail.ReadWrite",
    withMessage((c, _call, message) => {
      purgeMessage(context, message)

      return c.body(null, 204)
    }),
  )

  const relocate = (copy: boolean) =>
    withMessage(async (c, call, message) => {
      const destination = findFolder(
        context,
        call.user.oid,
        text((await jsonBody(c)).destinationId) ?? "",
      )

      if (!destination) return itemNotFound(c, context)

      const result = copy
        ? addMessage(context, call.user.oid, destination.graphId, copyFields(message))
        : moveMessage(context, message, destination.graphId)

      return messageResponse(c, result, 201)
    })

  userRoute(context, "post", "/messages/:id/move", "Mail.ReadWrite", relocate(false))
  userRoute(context, "post", "/messages/:id/copy", "Mail.ReadWrite", relocate(true))

  attachmentRoutes(context, withMessage)
}

type WithMessage = (
  handler: (c: Context, call: GraphCall, message: MessageRecord) => Response | Promise<Response>,
) => (c: Context, call: GraphCall) => Response | Promise<Response>

/** A message's file attachments: list, read one, and add one to a draft. */
function attachmentRoutes(context: MicrosoftRouteContext, withMessage: WithMessage): void {
  userRoute(
    context,
    "get",
    "/messages/:id/attachments",
    "Mail.Read",
    withMessage((c, _call, message) =>
      c.json({ value: message.attachments.map(attachmentObject) }),
    ),
  )

  userRoute(
    context,
    "get",
    "/messages/:id/attachments/:attachment",
    "Mail.Read",
    withMessage((c, _call, message) => {
      const found = message.attachments.find((a) => a.graphId === c.req.param("attachment"))

      return found ? c.json(attachmentObject(found)) : itemNotFound(c, context)
    }),
  )

  userRoute(
    context,
    "post",
    "/messages/:id/attachments",
    "Mail.ReadWrite",
    withMessage(async (c, _call, message) => {
      const attachment = attachmentInput(await jsonBody(c))

      if (!attachment)
        return graphError(c, context.clock, {
          status: 400,
          code: "ErrorInvalidRequest",
          message: "The attachment must have contentBytes.",
        })

      updateMessage(context, message, { attachments: [...message.attachments, attachment] })

      return c.json(attachmentObject(attachment), 201)
    }),
  )
}
