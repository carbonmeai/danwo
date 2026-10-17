import type { Context } from "../../http.ts"
import { type GraphCall, graphAccess } from "../access.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { driveOf, itemAtPath, itemIn, rootOf } from "../drive.ts"
import type { DriveRecord } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { DRIVE_ACTIONS } from "./drive-items.ts"
import { type DriveAddress, type DriveRequest, notFound } from "./drive-request.ts"
import { uploadRoutes } from "./uploads.ts"

/**
 * OneDrive paths do not fit fixed route patterns: an item can be named by id, by path
 * (`/root:/Documents/report.pdf:`), or by a path below an id, with an action after it. These
 * routes parse the path themselves.
 */

const DRIVE_PATH = /^\/v1\.0\/(?:me\/drive|users\/([^/]+)\/drive|drives\/([^/]+))(\/.*)?$/
const ITEM_PATH = /^\/(root|items\/([^/:]+))(?::(\/[^:]*):?)?(?:\/(\w+))?\/?$/

function decodeSegments(path: string | undefined): string[] {
  return (path ?? "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => decodeURIComponent(s))
}

/** Parses a drive path, or `undefined` when the path is not a drive's. */
function parseDrivePath(pathname: string): DriveAddress | undefined {
  const drive = DRIVE_PATH.exec(pathname)

  if (!drive) return undefined

  const [, user = "", driveId, rest = ""] = drive
  const common = {
    user: decodeURIComponent(user),
    driveId: driveId ? decodeURIComponent(driveId) : null,
  }

  if (rest === "" || rest === "/") return { ...common, base: null, path: [], action: "" }

  const item = ITEM_PATH.exec(rest)

  if (!item) return undefined

  const [, , id, path, action = ""] = item

  return {
    ...common,
    base: { id: id ? decodeURIComponent(id) : null },
    path: decodeSegments(path),
    action,
  }
}

function driveFor(
  context: MicrosoftRouteContext,
  call: GraphCall,
  address: DriveAddress,
): DriveRecord | undefined {
  const own = driveOf(context, call.user.oid)

  return address.driveId === null || address.driveId === own.graphId ? own : undefined
}

function resolve(
  context: MicrosoftRouteContext,
  call: GraphCall,
  address: DriveAddress,
): DriveRequest | undefined {
  const drive = driveFor(context, call, address)

  if (!drive) return undefined
  if (!address.base) return { call, drive, address, item: undefined, start: undefined }

  const start =
    address.base.id === null ? rootOf(context, drive) : itemIn(context, drive, address.base.id)
  const item = start && itemAtPath(context, start, address.path)

  return { call, drive, address, item, start }
}

const READS = new Set(["GET", "HEAD"])

/** Answers a drive request, or leaves it for other routes when the path is not a drive's. */
async function handleDrive(
  c: Context,
  context: MicrosoftRouteContext,
): Promise<Response | undefined> {
  const address = parseDrivePath(c.req.path)

  if (!address) return undefined

  const handler = DRIVE_ACTIONS[`${c.req.method} ${address.action}`]

  if (!handler)
    return graphError(c, context.clock, {
      status: 400,
      code: "invalidRequest",
      message: "Invalid request",
    })

  const call = graphAccess(
    c,
    context,
    READS.has(c.req.method) ? "Files.Read" : "Files.ReadWrite",
    address.user,
  )

  if (call instanceof Response) return call

  const request = resolve(context, call, address)

  return request ? handler(c, context, request) : notFound(c, context)
}

/** OneDrive: the drive, its items by id or path, uploads, downloads and copy monitors. */
export function driveRoutes(context: MicrosoftRouteContext): void {
  context.app.use((c) => handleDrive(c, context))
  uploadRoutes(context)
}
