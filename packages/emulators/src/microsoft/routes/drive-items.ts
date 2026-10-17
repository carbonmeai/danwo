import type { Context } from "../../http.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import {
  driveItemObject,
  driveObject,
  GRAPH_ORIGIN,
  ownerPermission,
  sharingLinkObject,
} from "../drive-formatters.ts"
import { childrenOf, copyItem, deleteItem, itemIn, putItem, updateItem } from "../drive.ts"
import type { DriveItemRecord } from "../entities.ts"
import { graphError, graphId } from "../helpers.ts"
import { asObject, jsonBody, type JsonObject, text } from "../input.ts"
import { listResponse } from "../odata.ts"
import { driveDelta } from "./drive-delta.ts"
import {
  conflictBehavior,
  type DriveAction,
  type DriveRequest,
  notFound,
  uploadPlace,
} from "./drive-request.ts"
import { createUploadSession } from "./uploads.ts"

function itemResponse(
  c: Context,
  context: MicrosoftRouteContext,
  request: DriveRequest,
  item: DriveItemRecord,
  status = 200,
) {
  return c.json(driveItemObject(context, request.drive, item), status)
}

/** Graph's 412 when `If-Match` names an older version of the item. */
function staleVersion(
  c: Context,
  context: MicrosoftRouteContext,
  item: DriveItemRecord,
): Response | undefined {
  const expected = c.req.header("if-match")
  const current = [`"{${item.graphId}},${item.version}"`, `"c:{${item.graphId}},${item.version}"`]

  if (!expected || expected === "*" || current.includes(expected)) return undefined

  return graphError(c, context.clock, {
    status: 412,
    code: "resourceModified",
    message: "ETag does not match current item's value",
  })
}

/** Runs `action` on the named item, or answers 404 when it does not exist. */
function existing(
  action: (
    c: Context,
    context: MicrosoftRouteContext,
    request: DriveRequest,
    item: DriveItemRecord,
  ) => Response | Promise<Response>,
): DriveAction {
  return (c, context, request) =>
    request.item ? action(c, context, request, request.item) : notFound(c, context)
}

const getItem: DriveAction = (c, context, request) => {
  if (!request.address.base) return c.json(driveObject(context, request.drive, request.call.user))

  return request.item ? itemResponse(c, context, request, request.item) : notFound(c, context)
}

const children = existing((c, context, request, folder) =>
  c.json(
    listResponse(
      c,
      childrenOf(context, folder).map((i) => driveItemObject(context, request.drive, i)),
      {
        defaultPageSize: 200,
        defaultOrder: "name",
      },
    ),
  ),
)

const createFolder = existing(async (c, context, request, folder) => {
  const body = await jsonBody(c)
  const name = text(body.name)

  if (!name)
    return graphError(c, context.clock, {
      status: 400,
      code: "invalidRequest",
      message: "The name property is required.",
    })

  const content = body.file === undefined ? undefined : Buffer.alloc(0)
  const { item } = putItem(
    context,
    folder,
    { name, ...(content && { content }) },
    conflictBehavior(c, body, "fail"),
  )

  return itemResponse(c, context, request, item, 201)
})

const download = existing((c, context, _request, item) =>
  item.isFolder
    ? graphError(c, context.clock, {
        status: 400,
        code: "invalidRequest",
        message: "Folders have no content.",
      })
    : c.redirect(`${GRAPH_ORIGIN}/download/${item.downloadToken}`, 302),
)

/**
 * A small upload: writes the file at the named path or id, creating missing folders. An existing
 * file is replaced unless the request's conflict behaviour says to fail or rename.
 */
const upload: DriveAction = async (c, context, request) => {
  const conflict = request.item && staleVersion(c, context, request.item)

  if (conflict) return conflict

  const place = uploadPlace(context, request)

  if (!place) return notFound(c, context)

  const mimeType = c.req.header("content-type")
  const content = Buffer.from(await c.req.arrayBuffer())
  const placed = putItem(
    context,
    place.folder,
    { name: place.name, content, ...(mimeType && { mimeType }) },
    conflictBehavior(c, {}, "replace"),
  )

  return itemResponse(c, context, request, placed.item, placed.created ? 201 : 200)
}

/** The target folder of a move or copy: `parentReference.id` in the request, or the item's own. */
function targetFolder(
  context: MicrosoftRouteContext,
  request: DriveRequest,
  body: JsonObject,
): DriveItemRecord | undefined {
  const id = text(asObject(body.parentReference).id)

  return id ? itemIn(context, request.drive, id) : undefined
}

const patchItem = existing(async (c, context, request, item) => {
  const conflict = staleVersion(c, context, item)

  if (conflict) return conflict

  const body = await jsonBody(c)
  const parent =
    body.parentReference === undefined ? undefined : targetFolder(context, request, body)

  if (body.parentReference !== undefined && !parent) return notFound(c, context)

  const name = text(body.name)
  const updated = updateItem(context, item, {
    ...(name && { name }),
    ...(parent && { parentId: parent.graphId }),
  })

  return itemResponse(c, context, request, updated)
})

const removeItem = existing((c, context, _request, item) => {
  const conflict = staleVersion(c, context, item)

  if (conflict) return conflict
  deleteItem(context, item)

  return c.body(null, 204)
})

/** Copies at once; the monitor URL in `Location` already reports the copy as done. */
const copy = existing(async (c, context, request, item) => {
  const body = await jsonBody(c)
  const parent =
    body.parentReference === undefined ? undefined : targetFolder(context, request, body)
  const folder =
    parent ?? (item.parentId === null ? undefined : itemIn(context, request.drive, item.parentId))

  if (!folder) return notFound(c, context)

  const made = copyItem(context, item, folder, text(body.name) ?? item.name)

  return c.body(null, 202, { location: `${GRAPH_ORIGIN}/monitor/${made.graphId}` })
})

const createLink = existing(async (c, context, request, item) => {
  const body = await jsonBody(c)
  const type = text(body.type) === "edit" ? "edit" : "view"
  const scope = text(body.scope) === "organization" ? "organization" : "anonymous"
  const links = context.microsoft().links
  const found = links
    .findBy("itemId", item.graphId)
    .find((l) => l.type === type && l.scope === scope)
  const link =
    found ??
    links.insert({ graphId: graphId("", 12), owner: item.owner, itemId: item.graphId, type, scope })

  return c.json(sharingLinkObject(request.drive, link), found ? 200 : 201)
})

const permissions = existing((c, context, request, item) =>
  c.json({
    value: [
      ownerPermission(request.call.user),
      ...context
        .microsoft()
        .links.findBy("itemId", item.graphId)
        .map((l) => sharingLinkObject(request.drive, l)),
    ],
  }),
)

/** What each method and action does to the drive or item a request names. */
export const DRIVE_ACTIONS: Readonly<Record<string, DriveAction>> = {
  "GET ": getItem,
  "GET children": children,
  "POST children": createFolder,
  "GET content": download,
  "PUT content": upload,
  "POST createUploadSession": createUploadSession,
  "PATCH ": patchItem,
  "DELETE ": removeItem,
  "POST copy": copy,
  "POST createLink": createLink,
  "GET permissions": permissions,
  "GET delta": driveDelta,
}
