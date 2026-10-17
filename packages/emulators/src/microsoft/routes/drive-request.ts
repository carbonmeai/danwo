import type { Context } from "../../http.ts"
import type { GraphCall } from "../access.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { ensureFolders } from "../drive.ts"
import type { ConflictBehavior, DriveItemRecord, DriveRecord } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { type JsonObject, oneOf, text } from "../input.ts"

/** How a request named an item: the drive itself, its root, an id, and/or a path below them. */
export interface DriveAddress {
  readonly user: string
  readonly driveId: string | null
  /** `null` when the request is about the drive, not an item in it. */
  readonly base: { readonly id: string | null } | null
  readonly path: readonly string[]
  readonly action: string
}

/** A drive request, resolved: the drive, and the item it names if that exists. */
export interface DriveRequest {
  readonly call: GraphCall
  readonly drive: DriveRecord
  readonly address: DriveAddress
  /** The item the request names; `undefined` when a path names something not there (yet). */
  readonly item: DriveItemRecord | undefined
  /** Where the path starts: the root or the item named by id. */
  readonly start: DriveItemRecord | undefined
}

/** Graph's 404 for a drive item. */
export function notFound(c: Context, context: MicrosoftRouteContext): Response {
  return graphError(c, context.clock, {
    status: 404,
    code: "itemNotFound",
    message: "The resource could not be found.",
  })
}

/** What one method and action does to the drive or item a request names. */
export type DriveAction = (
  c: Context,
  context: MicrosoftRouteContext,
  request: DriveRequest,
) => Response | Promise<Response>

const CONFLICTS: readonly ConflictBehavior[] = ["fail", "replace", "rename"]

/** The conflict behaviour a request asks for in its query or body, or `fallback`. */
export function conflictBehavior(
  c: Context,
  body: JsonObject,
  fallback: ConflictBehavior,
): ConflictBehavior {
  const asked =
    c.req.query("@microsoft.graph.conflictBehavior") ??
    text(body["@microsoft.graph.conflictBehavior"])

  return oneOf(CONFLICTS, asked) ?? fallback
}

/** Where an upload lands: the existing file's folder and name, or the folder and name its path gives. */
export function uploadPlace(
  context: MicrosoftRouteContext,
  request: DriveRequest,
): { readonly folder: DriveItemRecord; readonly name: string } | undefined {
  const { item, start, address } = request

  if (item?.parentId) {
    const folder = context.microsoft().items.findOneBy("graphId", item.parentId)

    return folder && { folder, name: item.name }
  }

  if (!start || address.path.length === 0) return undefined

  return {
    folder: ensureFolders(context, start, address.path.slice(0, -1)),
    name: address.path.at(-1) ?? "file",
  }
}
