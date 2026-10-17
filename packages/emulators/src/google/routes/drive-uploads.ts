import { randomBytes } from "node:crypto"

import type { Context } from "../../http.ts"
import { type Caller, jsonBody, notFound, requireAccess } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import { createFile, fileResource, writableFile } from "../drive.ts"
import type { DriveFileRecord, DriveUploadRecord } from "../entities.ts"
import { withFields } from "../fields.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"
import { readUpload } from "../uploads.ts"
import { applyUpdate, FILE_FIELDS } from "./drive-files.ts"

const UPLOAD = "/upload/drive/v3/files"

/** Where the rest of a resumable upload goes. */
function sessionUrl(c: Context, uploadId: string): string {
  const url = new URL(c.req.url)

  url.searchParams.set("upload_id", uploadId)
  url.searchParams.set("uploadType", "resumable")

  return url.toString()
}

/** What a resumable PUT carries: the whole body, one chunk, or a status check (`start` -1). */
interface Chunk {
  readonly start: number
  readonly total: number | undefined
}

/** The `Content-Range` of a resumable PUT; `undefined` when it sends the whole content at once. */
function chunkOf(header: string | undefined): Chunk | undefined {
  const match = /^bytes (\d+|\*)(?:-\d+)?\/(\d+|\*)$/.exec(header ?? "")

  if (!match) return undefined

  return {
    start: match[1] === "*" ? -1 : Number(match[1]),
    total: match[2] === "*" ? undefined : Number(match[2]),
  }
}

/** The session's bytes once this request's are added. */
function bytesAfter(had: Buffer, chunk: Chunk | undefined, bytes: Buffer): Buffer {
  if (!chunk) return bytes

  return chunk.start < 0 ? had : Buffer.concat([had.subarray(0, chunk.start), bytes])
}

/**
 * Uploads: `media`, `multipart` and `resumable` for new files (POST) and new content (PATCH).
 * A resumable session answers 308 with the bytes it has until the last chunk arrives.
 */
export function driveUploadRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const uploads = () => googleStore(context.store).uploads

  const finish = (c: Context, caller: Caller, record: DriveFileRecord) =>
    c.json(withFields(fileResource(context, caller, record), c.req.query("fields"), FILE_FIELDS))

  /** Starts a resumable session; the file is made or changed once the bytes are in. */
  const startSession = async (c: Context, caller: Caller, fileId: string | null) => {
    const uploadId = randomBytes(24).toString("base64url")

    uploads().insert({
      uploadId,
      owner: caller.user.uid,
      clientId: caller.clientId,
      metadata: await jsonBody(c),
      fileId,
      received: "",
    })

    return c.body(null, 200, { location: sessionUrl(c, uploadId) })
  }

  app.post(UPLOAD, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)

    if (c.req.query("uploadType") === "resumable") return startSession(c, caller, null)

    const upload = await readUpload(c)
    const record = createFile(context, caller.user, caller.clientId, {
      metadata: upload.metadata,
      ...(upload.media && { content: upload.media }),
      ...(upload.mediaType && { mediaType: upload.mediaType }),
    })

    return finish(c, caller, record)
  })

  app.patch(`${UPLOAD}/:fileId`, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)
    const record = writableFile(context, caller, c.req.param("fileId"))

    if (c.req.query("uploadType") === "resumable") return startSession(c, caller, record.fileId)

    const upload = await readUpload(c)

    return finish(
      c,
      caller,
      applyUpdate(context, c, record, {
        metadata: upload.metadata,
        ...(upload.media && { content: upload.media }),
      }),
    )
  })

  /** Adds a chunk to a session; completes it when the total is reached. */
  const chunk = async (c: Context) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)
    const session = uploads().findOneBy("uploadId", c.req.query("upload_id") ?? "")

    if (!session || session.owner !== caller.user.uid) throw notFound("Upload session not found.")

    const chunk = chunkOf(c.req.header("content-range"))
    const received = bytesAfter(
      Buffer.from(session.received, "base64"),
      chunk,
      Buffer.from(await c.req.arrayBuffer()),
    )
    const complete = !chunk || (chunk.total !== undefined && received.length >= chunk.total)

    if (!complete) {
      uploads().update(session.id, { received: received.toString("base64") })

      return c.body(
        null,
        308,
        received.length > 0 ? { range: `bytes=0-${received.length - 1}` } : {},
      )
    }

    uploads().delete(session.id)

    return finish(c, caller, completeSession(context, c, caller, session, received))
  }

  app.put(UPLOAD, chunk)
  app.put(`${UPLOAD}/:fileId`, chunk)
}

/** Makes or updates the file a finished resumable session was for. */
function completeSession(
  context: GoogleRouteContext,
  c: Context,
  caller: Caller,
  session: DriveUploadRecord,
  content: Buffer,
): DriveFileRecord {
  if (session.fileId === null)
    return createFile(context, caller.user, session.clientId, {
      metadata: session.metadata,
      content,
    })

  return applyUpdate(context, c, writableFile(context, caller, session.fileId), {
    metadata: session.metadata,
    content,
  })
}
