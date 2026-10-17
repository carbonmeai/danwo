import type { Context } from "../http.ts"
import { badRequest, recordOf } from "./api.ts"
import { headerOf, headerParam, parseHeaders, splitParts } from "./mime.ts"

/** What an upload request carries: JSON metadata and, for media uploads, the bytes. */
export interface Upload {
  readonly metadata: Record<string, unknown>
  readonly media: Buffer | undefined
  /** The media's content type, when the request said. */
  readonly mediaType: string | undefined
}

/** Splits a `multipart/related` upload into its metadata part and its media part. */
function multipartUpload(bytes: Buffer, contentType: string): Upload {
  const boundary = headerParam(contentType, "boundary")

  if (!boundary) throw badRequest("Missing multipart boundary.")

  const [first, second] = splitParts(bytes.toString("latin1"), boundary).map((part) => {
    const split = /\r?\n\r?\n/.exec(part)
    const head = split ? part.slice(0, split.index) : ""
    const body = split ? part.slice(split.index + split[0].length) : part

    return { headers: parseHeaders(head), body }
  })

  return {
    metadata: recordOf(Buffer.from(first?.body ?? "", "latin1").toString("utf8")),
    media: second && Buffer.from(second.body, "latin1"),
    mediaType: second && headerOf(second.headers, "content-type"),
  }
}

/**
 * Reads an upload as `uploadType` says: `media` (the body is the content), `multipart` (metadata
 * then content in one `multipart/related` body) or no upload type (JSON metadata only).
 */
export async function readUpload(c: Context): Promise<Upload> {
  const bytes = Buffer.from(await c.req.arrayBuffer())
  const contentType = c.req.header("content-type") ?? ""

  switch (c.req.query("uploadType")) {
    case "media":
      return { metadata: {}, media: bytes, mediaType: contentType || undefined }
    case "multipart":
      return multipartUpload(bytes, contentType)
    default:
      return { metadata: recordOf(bytes.toString("utf8")), media: undefined, mediaType: undefined }
  }
}
