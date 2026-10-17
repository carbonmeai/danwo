import type { Context } from "../../http.ts"
import type { GraphCall } from "../access.ts"
import { userRoute } from "../access.ts"
import { changesSince, decodeToken, encodeToken, latestChange } from "../changes.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import type { MailFolderRecord, MessageRecord } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { jsonBody, text } from "../input.ts"
import { createFolder, mailFolders } from "../mailbox.ts"
import { listResponse, pageSize, selected, withParam } from "../odata.ts"
import { mailFolderObject, messageObject } from "../outlook-formatters.ts"
import { appliedHeaders, preferences } from "./mail-input.ts"
import { folderParam } from "./messages.ts"

function folderList(c: Context, call: GraphCall, folders: readonly MailFolderRecord[]): Response {
  const messages = call.microsoft.messages.findBy("owner", call.user.oid)

  return c.json(
    listResponse(
      c,
      folders.map((f) => mailFolderObject(f, messages)),
      { defaultPageSize: 10 },
    ),
  )
}

/** Graph's answer to a delta token it no longer (or never) knew. */
function syncStateGone(c: Context, context: MicrosoftRouteContext): Response {
  return graphError(c, context.clock, {
    status: 410,
    code: "SyncStateNotFound",
    message: "The sync state generation is no longer valid. Please resync.",
  })
}

/** Where a delta request stands: first pages from an offset, or changes after a position. */
type DeltaState =
  | { readonly phase: "initial"; readonly since: number; readonly offset: number }
  | { readonly phase: "changes"; readonly since: number }

function deltaState(c: Context, folderId: string): DeltaState | undefined {
  const skip = c.req.query("$skiptoken")
  const raw = skip ?? c.req.query("$deltatoken")

  if (raw === undefined) return { phase: "initial", since: -1, offset: 0 }

  const token = decodeToken(raw)
  const since = token?.f === folderId ? token.s : undefined

  if (typeof since !== "number") return undefined

  return skip === undefined
    ? { phase: "changes", since }
    : { phase: "initial", since, offset: Number(token?.o) || 0 }
}

const REMOVED = { "@removed": { reason: "deleted" } }

/**
 * The folder's message delta: the first round pages through every message in the folder, then
 * ends with a delta link; each later round returns what changed since, with `@removed` for
 * messages deleted or moved out.
 */
function messageDelta(
  c: Context,
  context: MicrosoftRouteContext,
  call: GraphCall,
  folder: MailFolderRecord,
) {
  const state = deltaState(c, folder.graphId)

  if (!state) return syncStateGone(c, context)

  const base = `${new URL(c.req.url).origin}${new URL(c.req.url).pathname}`
  const prefs = preferences(c)
  const select = c.req.query("$select")
  const shown = (m: MessageRecord) => selected(messageObject(m, prefs), select)

  if (state.phase === "changes") {
    const value = changesSince(context, {
      owner: call.user.oid,
      kind: "message",
      since: state.since,
      where: (change) => change.folderId === folder.graphId,
    }).map((change) => {
      const message = call.microsoft.messages.findOneBy("graphId", change.targetId)

      return message?.folderId === folder.graphId
        ? shown(message)
        : { id: change.targetId, ...REMOVED }
    })

    return c.json(
      {
        value,
        "@odata.deltaLink": withParam(
          base,
          "$deltatoken",
          encodeToken({ f: folder.graphId, s: latestChange(context) }),
        ),
      },
      200,
      appliedHeaders(c),
    )
  }

  const since = state.since >= 0 ? state.since : latestChange(context)
  const inFolder = call.microsoft.messages
    .findBy("owner", call.user.oid)
    .filter((m) => m.folderId === folder.graphId)
    .toSorted((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const size = pageSize(c, 10)
  const page = inFolder.slice(state.offset, state.offset + size).map(shown)
  const next = state.offset + size
  const link =
    next < inFolder.length
      ? {
          "@odata.nextLink": withParam(
            base,
            "$skiptoken",
            encodeToken({ f: folder.graphId, s: since, o: next }),
          ),
        }
      : {
          "@odata.deltaLink": withParam(
            base,
            "$deltatoken",
            encodeToken({ f: folder.graphId, s: since }),
          ),
        }

  return c.json({ value: page, ...link }, 200, appliedHeaders(c))
}

/** Mail folders: the well-known ones, folders an app creates, and each folder's message delta. */
export function mailFolderRoutes(context: MicrosoftRouteContext): void {
  userRoute(context, "get", "/mailFolders", "Mail.Read", (c, call) =>
    folderList(
      c,
      call,
      mailFolders(context, call.user.oid).filter((f) => f.parentId === null),
    ),
  )

  userRoute(context, "get", "/mailFolders/:folder", "Mail.Read", (c, call) => {
    const folder = folderParam(c, context, call)

    return folder instanceof Response
      ? folder
      : c.json(mailFolderObject(folder, call.microsoft.messages.findBy("owner", call.user.oid)))
  })

  userRoute(context, "get", "/mailFolders/:folder/childFolders", "Mail.Read", (c, call) => {
    const folder = folderParam(c, context, call)

    if (folder instanceof Response) return folder

    return folderList(
      c,
      call,
      mailFolders(context, call.user.oid).filter((f) => f.parentId === folder.graphId),
    )
  })

  const create = async (c: Context, call: GraphCall, parentId: string | null) => {
    const name = text((await jsonBody(c)).displayName)

    if (!name)
      return graphError(c, context.clock, {
        status: 400,
        code: "ErrorInvalidRequest",
        message: "The displayName property is required.",
      })

    const siblings = mailFolders(context, call.user.oid).filter((f) => f.parentId === parentId)

    if (siblings.some((f) => f.displayName.toLowerCase() === name.toLowerCase()))
      return graphError(c, context.clock, {
        status: 409,
        code: "ErrorFolderExists",
        message: "A folder with the specified name already exists.",
      })

    return c.json(mailFolderObject(createFolder(context, call.user.oid, name, parentId), []), 201)
  }

  userRoute(context, "post", "/mailFolders", "Mail.ReadWrite", (c, call) => create(c, call, null))

  userRoute(context, "post", "/mailFolders/:folder/childFolders", "Mail.ReadWrite", (c, call) => {
    const folder = folderParam(c, context, call)

    return folder instanceof Response ? folder : create(c, call, folder.graphId)
  })

  userRoute(context, "get", "/mailFolders/:folder/messages/delta", "Mail.Read", (c, call) => {
    const folder = folderParam(c, context, call)

    return folder instanceof Response ? folder : messageDelta(c, context, call, folder)
  })
}
