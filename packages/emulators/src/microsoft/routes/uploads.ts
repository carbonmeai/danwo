import type { UploadSession } from "@microsoft/microsoft-graph-types"

import type { Context } from "../../http.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { driveItemObject, GRAPH_ORIGIN } from "../drive-formatters.ts"
import { putItem } from "../drive.ts"
import type { UploadSessionRecord } from "../entities.ts"
import { graphError, graphId } from "../helpers.ts"
import { asObject, jsonBody } from "../input.ts"
import { conflictBehavior, type DriveAction, notFound, uploadPlace } from "./drive-request.ts"

/** How long an upload session stays open. */
const SESSION_MS = 7 * 24 * 60 * 60 * 1000

function sessionBody(session: UploadSessionRecord, received: number) {
  return {
    expirationDateTime: session.expiresAt,
    nextExpectedRanges: [`${received}-`],
  } satisfies UploadSession
}

/** `createUploadSession`: opens a resumable upload for a new file or a new version of one. */
export const createUploadSession: DriveAction = async (c, context, request) => {
  const target = uploadPlace(context, request)

  if (!target) return notFound(c, context)

  const body = asObject((await jsonBody(c)).item)
  const session = context.microsoft().uploads.insert({
    graphId: graphId("", 32),
    owner: request.call.user.oid,
    driveId: request.drive.graphId,
    parentId: target.folder.graphId,
    name: target.name,
    conflict: conflictBehavior(c, body, "replace"),
    total: 0,
    received: "",
    expiresAt: new Date(context.clock().getTime() + SESSION_MS).toISOString(),
  })

  return c.json({ uploadUrl: `${GRAPH_ORIGIN}/up/${session.graphId}`, ...sessionBody(session, 0) })
}

const RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/

function badRange(
  c: Context,
  context: MicrosoftRouteContext,
  status: number,
  message: string,
): Response {
  return graphError(c, context.clock, { status, code: "invalidRange", message })
}

/** Stores the file once every byte has arrived: 201 for a new file, 200 for a new version. */
function finish(
  c: Context,
  context: MicrosoftRouteContext,
  session: UploadSessionRecord,
  bytes: Buffer,
) {
  const microsoft = context.microsoft()
  const folder = microsoft.items.findOneBy("graphId", session.parentId)
  const drive = microsoft.drives.findOneBy("graphId", session.driveId)

  microsoft.uploads.delete(session.id)
  if (!folder || !drive) return notFound(c, context)

  const placed = putItem(context, folder, { name: session.name, content: bytes }, session.conflict)

  return c.json(driveItemObject(context, drive, placed.item), placed.created ? 201 : 200)
}

/** One fragment of a resumable upload, which must start where the last one ended. */
async function putFragment(
  c: Context,
  context: MicrosoftRouteContext,
  session: UploadSessionRecord,
) {
  const range = RANGE.exec(c.req.header("content-range") ?? "")

  if (!range) return badRange(c, context, 400, "The Content-Range header is missing or malformed.")

  const [start = 0, end = 0, total = 0] = range.slice(1).map(Number)
  const received = Buffer.from(session.received, "base64")
  const fragment = Buffer.from(await c.req.arrayBuffer())

  if (start !== received.length)
    return badRange(
      c,
      context,
      416,
      "The uploaded fragment does not fit within the expected range.",
    )
  if (fragment.length !== end - start + 1 || end >= total)
    return badRange(c, context, 400, "The fragment's length does not match its Content-Range.")

  const bytes = Buffer.concat([received, fragment])

  if (bytes.length === total) return finish(c, context, session, bytes)

  const updated =
    context.microsoft().uploads.update(session.id, { total, received: bytes.toString("base64") }) ??
    session

  return c.json(sessionBody(updated, bytes.length), 202)
}

function liveSession(context: MicrosoftRouteContext, id: string): UploadSessionRecord | undefined {
  const session = context.microsoft().uploads.findOneBy("graphId", id)

  return session && Date.parse(session.expiresAt) > context.clock().getTime() ? session : undefined
}

/** An upload URL's methods: send a fragment, read the status, or cancel. */
function handleUpload(
  c: Context,
  context: MicrosoftRouteContext,
): Response | Promise<Response> | undefined {
  const id = /^\/up\/([^/]+)$/.exec(c.req.path)?.[1]

  if (!id) return undefined

  const session = liveSession(context, id)

  if (!session) return notFound(c, context)
  if (c.req.method === "PUT") return putFragment(c, context, session)

  if (c.req.method === "DELETE") {
    context.microsoft().uploads.delete(session.id)

    return c.body(null, 204)
  }

  return c.json(sessionBody(session, Buffer.from(session.received, "base64").length))
}

/** Upload sessions, pre-authenticated downloads, and copy monitors, outside `/v1.0`. */
export function uploadRoutes(context: MicrosoftRouteContext): void {
  context.app.use((c) => handleUpload(c, context))

  context.app.get("/download/:token", (c) => {
    const item = context.microsoft().items.findOneBy("downloadToken", c.req.param("token"))

    if (!item || item.isFolder) return notFound(c, context)

    const bytes = Buffer.from(item.content ?? "", "base64")

    return c.body(bytes, 200, {
      "content-type": item.mimeType ?? "application/octet-stream",
      "content-length": String(bytes.length),
    })
  })

  context.app.get("/monitor/:id", (c) => {
    const item = context.microsoft().items.findOneBy("graphId", c.req.param("id"))

    return item
      ? c.json({ status: "completed", percentageComplete: 100, resourceId: item.graphId })
      : notFound(c, context)
  })
}
