import type { S3RouteContext, S3ObjectCall } from "../context.ts"
import type { PartRecord, UploadRecord } from "../entities.ts"
import { uploadCompleted, uploadStarted } from "../formatters.ts"
import {
  aclFrom,
  badRequest,
  contentTypeFrom,
  hasQuery,
  headersFrom,
  md5Hex,
  metadataFrom,
  multipartEtag,
  newUploadId,
  readBody,
  S3Error,
  xmlTexts,
} from "../helpers.ts"
import { type S3Store, s3Store, storeObject } from "../store.ts"
import { requireBucket } from "./buckets.ts"
import { contentOf } from "./objects.ts"

/** Every part but the last must be at least 5 MiB. */
const MIN_PART_SIZE = 5 * 1024 * 1024

const xml = { "content-type": "application/xml" }

function requireUpload(s3: S3Store, { c, bucket, key }: S3ObjectCall): UploadRecord {
  const id = c.req.query("uploadId") ?? ""
  const upload = s3.uploads.findOneBy("uploadId", id)

  if (!upload || upload.bucket !== bucket || upload.key !== key)
    throw new S3Error(
      "NoSuchUpload",
      "The specified upload does not exist. The upload ID may be invalid, or the upload may have been aborted or completed.",
      404,
    )

  return upload
}

/** Forgets an upload and its parts. */
function discard(s3: S3Store, upload: UploadRecord): void {
  for (const part of s3.parts.findBy("uploadId", upload.uploadId)) s3.parts.delete(part.id)
  s3.uploads.delete(upload.id)
}

/** The parts a complete request lists, in its order, checked against what was uploaded. */
function chosenParts(s3: S3Store, upload: UploadRecord, body: string): PartRecord[] {
  const numbers = xmlTexts(body, "PartNumber").map(Number)
  const etags = xmlTexts(body, "ETag").map((etag) => etag.replaceAll('"', ""))
  const uploaded = s3.parts.findBy("uploadId", upload.uploadId)
  const parts = numbers.map((number, index) => {
    const part = uploaded.find((p) => p.number === number)

    if (!part || part.etag !== etags[index])
      throw badRequest("InvalidPart", "One or more of the specified parts could not be found.")

    return part
  })

  if (parts.some((part, index) => index > 0 && part.number <= (parts[index - 1]?.number ?? 0)))
    throw badRequest("InvalidPartOrder", "The list of parts was not in ascending order.")
  if (parts.slice(0, -1).some((part) => part.size < MIN_PART_SIZE))
    throw badRequest(
      "EntityTooSmall",
      "Your proposed upload is smaller than the minimum allowed object size.",
    )

  return parts
}

/** CreateMultipartUpload, UploadPart, CompleteMultipartUpload and AbortMultipartUpload. */
export function multipartUploadRoutes({ router, store, clock }: S3RouteContext): void {
  const s3 = () => s3Store(store)

  router.object(
    "POST",
    ({ c, bucket, key }) => {
      requireBucket(s3(), bucket)

      const uploadId = newUploadId()

      s3().uploads.insert({
        uploadId,
        bucket,
        key,
        contentType: contentTypeFrom(c),
        metadata: metadataFrom(c),
        headers: headersFrom(c),
        acl: aclFrom(c),
      })

      return c.body(uploadStarted(bucket, key, uploadId), 200, xml)
    },
    hasQuery("uploads"),
  )

  router.object(
    "PUT",
    async (call) => {
      const upload = requireUpload(s3(), call)
      const number = Number(call.c.req.query("partNumber"))
      const bytes = await readBody(call.c)
      const etag = md5Hex(bytes)
      const previous = s3()
        .parts.findBy("uploadId", upload.uploadId)
        .find((part) => part.number === number)

      if (previous) s3().parts.delete(previous.id)
      s3().parts.insert({
        uploadId: upload.uploadId,
        number,
        body: bytes.toString("base64"),
        size: bytes.length,
        etag,
      })

      return call.c.body(null, 200, { etag: `"${etag}"` })
    },
    hasQuery("uploadId"),
  )

  router.object(
    "POST",
    async (call) => {
      const upload = requireUpload(s3(), call)
      const parts = chosenParts(s3(), upload, await call.c.req.text())
      const bytes = Buffer.concat(parts.map((part) => Buffer.from(part.body, "base64")))
      const object = storeObject(s3(), upload.bucket, upload.key, {
        ...contentOf(bytes, upload, clock),
        etag: multipartEtag(parts.map((part) => part.etag)),
      })

      discard(s3(), upload)

      return call.c.body(uploadCompleted(`/${upload.bucket}/${upload.key}`, object), 200, xml)
    },
    hasQuery("uploadId"),
  )

  router.object(
    "DELETE",
    (call) => {
      discard(s3(), requireUpload(s3(), call))

      return call.c.body(null, 204)
    },
    hasQuery("uploadId"),
  )
}
