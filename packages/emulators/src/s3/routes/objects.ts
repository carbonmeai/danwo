import type { Context } from "../../http.ts"
import { asRecord, oneOf } from "../../json.ts"
import type { Clock } from "../../store.ts"
import { checkWrite, readNotModified } from "../conditions.ts"
import type { S3RouteContext, S3ObjectCall } from "../context.ts"
import type { ObjectChecksum, ObjectContent, ObjectRecord } from "../entities.ts"
import { checksumHeaders, copyResult, formPosted, objectHeaders } from "../formatters.ts"
import {
  ACLS,
  aclFrom,
  badRequest,
  contentTypeFrom,
  hasQuery,
  headersFrom,
  md5Hex,
  metadataFrom,
  noSuchKey,
  onTigris,
  readWrite,
  S3Error,
} from "../helpers.ts"
import { objectAt, objectBytes, type S3Store, s3Store, storeObject } from "../store.ts"
import { requireBucket } from "./buckets.ts"

/** What an object written from `bytes` is described with, keeping the checksum the writer sent. */
export function contentOf(
  bytes: Buffer,
  fields: Pick<ObjectContent, "contentType" | "metadata" | "headers" | "acl">,
  clock: Clock,
  checksum?: ObjectChecksum,
): ObjectContent {
  return {
    ...fields,
    body: bytes.toString("base64"),
    size: bytes.length,
    etag: md5Hex(bytes),
    modified: clock().toISOString(),
    ...(checksum && { checksum }),
  }
}

function requireObject(s3: S3Store, bucket: string, key: string): ObjectRecord {
  requireBucket(s3, bucket)

  const object = objectAt(s3, bucket, key)

  if (!object) throw noSuchKey()

  return object
}

/** `bytes=2-5`, `bytes=5-` or `bytes=-3` against `size`, as `[start, end]` inclusive. */
function rangeOf(header: string, size: number): [number, number] | undefined {
  const [, from = "", to = ""] = /^bytes=(\d*)-(\d*)$/.exec(header.trim()) ?? []

  if (from === "" && to === "") return undefined

  const [start, end] =
    from === "" ? lastBytes(Number(to), size) : [Number(from), lastIndex(to, size)]

  return start <= end && start < size ? [start, end] : undefined
}

/** The final `count` bytes (a suffix range). */
function lastBytes(count: number, size: number): [number, number] {
  return [Math.max(0, size - count), size - 1]
}

/** Where an explicit range ends: its upper bound, or the end of the object when open-ended. */
function lastIndex(to: string, size: number): number {
  return to === "" ? size - 1 : Math.min(Number(to), size - 1)
}

const OVERRIDES = [
  "content-type",
  "content-language",
  "expires",
  "cache-control",
  "content-disposition",
  "content-encoding",
] as const

/** A presigned GET's `response-content-disposition=…` and friends, which replace stored headers. */
function overrides(c: Context): Record<string, string> {
  const query = new URL(c.req.url).searchParams

  return Object.fromEntries(
    OVERRIDES.flatMap((name) => {
      const value = query.get(`response-${name}`)

      return value === null ? [] : [[name, value]]
    }),
  )
}

/**
 * Whether a read answers with the object's checksum: when asked (`x-amz-checksum-mode`), and on
 * Tigris always; never for a range, since a checksum covers the whole object.
 */
function wantsChecksum(c: Context, range: string | undefined): boolean {
  if (range !== undefined) return false

  return c.req.header("x-amz-checksum-mode") === "ENABLED" || onTigris(c)
}

/** The headers of a 304: the object's validators only. */
function notModifiedHeaders(object: ObjectRecord): Record<string, string> {
  return { etag: `"${object.etag}"`, "last-modified": new Date(object.modified).toUTCString() }
}

/** GetObject and HeadObject, with conditions, single byte ranges and checksums on request. */
function readObject({ c, bucket, key }: S3ObjectCall, s3: S3Store, withBody: boolean): Response {
  const object = requireObject(s3, bucket, key)

  if (readNotModified(c, object)) return c.body(null, 304, notModifiedHeaders(object))

  const wanted = c.req.header("range")
  const checksums = wantsChecksum(c, wanted) ? checksumHeaders(object) : {}
  const headers = { ...objectHeaders(object), ...checksums, ...overrides(c) }
  const bytes = objectBytes(object)

  if (wanted === undefined) return c.body(withBody ? new Uint8Array(bytes) : null, 200, headers)

  const range = rangeOf(wanted, object.size)

  if (!range) throw new S3Error("InvalidRange", "The requested range is not satisfiable", 416)

  const [start, end] = range

  return c.body(withBody ? new Uint8Array(bytes.subarray(start, end + 1)) : null, 206, {
    ...headers,
    "content-length": String(end - start + 1),
    "content-range": `bytes ${start}-${end}/${object.size}`,
  })
}

/** `x-amz-copy-source`: `bucket/key` (URL-encoded), with or without a leading slash or version. */
function copySource(c: Context): { bucket: string; key: string } {
  const raw = decodeURIComponent(
    (c.req.header("x-amz-copy-source") ?? "").replace(/^\//, "").split("?")[0] ?? "",
  )
  const slash = raw.indexOf("/")

  if (slash <= 0)
    throw badRequest(
      "InvalidArgument",
      "Copy Source must mention the source bucket and key: sourcebucket/sourcekey",
    )

  return { bucket: raw.slice(0, slash), key: raw.slice(slash + 1) }
}

/** CopyObject, and Tigris's rename (a copy with `X-Tigris-Rename: true` that removes the source). */
function copyObject({ c, bucket, key }: S3ObjectCall, s3: S3Store, clock: Clock): Response {
  requireBucket(s3, bucket)

  const from = copySource(c)
  const source = requireObject(s3, from.bucket, from.key)
  const replace = c.req.header("x-amz-metadata-directive") === "REPLACE"
  const described = replace
    ? { contentType: contentTypeFrom(c), metadata: metadataFrom(c), headers: headersFrom(c) }
    : { contentType: source.contentType, metadata: source.metadata, headers: source.headers }
  const copy = storeObject(s3, bucket, key, {
    ...contentOf(objectBytes(source), { ...described, acl: aclFrom(c) }, clock),
    etag: source.etag,
  })

  if (c.req.header("x-tigris-rename") === "true" && (from.bucket !== bucket || from.key !== key))
    s3.objects.delete(source.id)

  const headers: Record<string, string> = { "content-type": "application/xml" }

  // Tigris also gives the copy's ETag as a header, beside the copy result document.
  if (onTigris(c)) headers["etag"] = `"${copy.etag}"`

  return c.body(copyResult(copy), 200, headers)
}

async function putObject(
  { c, bucket, key }: S3ObjectCall,
  s3: S3Store,
  clock: Clock,
): Promise<Response> {
  requireBucket(s3, bucket)
  checkWrite(c, objectAt(s3, bucket, key))

  const { bytes, checksum } = await readWrite(c)
  const content = contentOf(
    bytes,
    {
      contentType: contentTypeFrom(c),
      metadata: metadataFrom(c),
      headers: headersFrom(c),
      acl: aclFrom(c),
    },
    clock,
    checksum,
  )
  const stored = storeObject(s3, bucket, key, content)

  return c.body(null, 200, { etag: `"${stored.etag}"`, ...checksumHeaders(stored) })
}

/** A browser form upload's policy conditions, from its base64 `Policy` field. */
function policyConditions(fields: Record<string, string | File>): unknown[] {
  const policy = fields.Policy ?? fields.policy

  if (typeof policy !== "string") return []

  const parsed: unknown = JSON.parse(Buffer.from(policy, "base64").toString("utf8"))
  const conditions = asRecord(parsed)?.conditions

  return Array.isArray(conditions) ? conditions : []
}

type Condition = readonly [string, unknown, unknown]

/** `["content-length-range", min, max]`: the file's size must be within the bounds. */
function checkSize([, min, max]: Condition, size: number): void {
  if (size > Number(max))
    throw badRequest("EntityTooLarge", "Your proposed upload exceeds the maximum allowed size")
  if (size < Number(min))
    throw badRequest(
      "EntityTooSmall",
      "Your proposed upload is smaller than the minimum allowed size",
    )
}

/** `["starts-with", "$Field", "prefix"]`: the form field must start with the prefix. */
function checkPrefix([, subject, prefix]: Condition, fields: Record<string, string | File>): void {
  const field = fields[String(subject).replace(/^\$/, "")]

  if (typeof field === "string" && !field.startsWith(String(prefix)))
    throw accessDeniedPolicy(String(subject))
}

/** Checks the size and field conditions a presigned POST's policy sets. */
function checkPolicy(
  conditions: readonly unknown[],
  fields: Record<string, string | File>,
  size: number,
): void {
  for (const condition of conditions.filter((c): c is Condition => Array.isArray(c))) {
    if (condition[0] === "content-length-range") checkSize(condition, size)
    if (condition[0] === "starts-with") checkPrefix(condition, fields)
  }
}

function accessDeniedPolicy(subject: string): S3Error {
  return new S3Error(
    "AccessDenied",
    `Invalid according to Policy: Policy Condition failed: ${subject}`,
    403,
  )
}

/** PostObject: a browser form with a presigned policy uploads one file to the bucket. */
async function postForm(c: Context, bucket: string, s3: S3Store, clock: Clock): Promise<Response> {
  requireBucket(s3, bucket)

  const fields = await c.req.parseBody()
  const file = fields.file

  if (!(file instanceof File))
    throw badRequest("InvalidArgument", "POST requires exactly one file upload per request.")

  const bytes = Buffer.from(await file.arrayBuffer())

  checkPolicy(policyConditions(fields), fields, bytes.length)

  const key = (typeof fields.key === "string" ? fields.key : "").replaceAll(
    "${filename}",
    file.name,
  )
  const contentType =
    typeof fields["Content-Type"] === "string"
      ? fields["Content-Type"]
      : file.type || "binary/octet-stream"
  const acl = oneOf(ACLS, fields.acl, "private")
  const object = storeObject(
    s3,
    bucket,
    key,
    contentOf(bytes, { contentType, metadata: {}, headers: {}, acl }, clock),
  )
  const status = Number(
    typeof fields.success_action_status === "string" ? fields.success_action_status : 204,
  )

  return status === 201
    ? c.body(formPosted(`/${bucket}/${key}`, object), 201, { "content-type": "application/xml" })
    : c.body(null, status === 200 ? 200 : 204, { etag: `"${object.etag}"` })
}

/** Object reads and writes, copies, renames, ACL changes and browser form uploads. */
export function objectRoutes({ router, store, clock }: S3RouteContext): void {
  const s3 = () => s3Store(store)

  router.object("GET", (call) => readObject(call, s3(), true))
  router.object("HEAD", (call) => readObject(call, s3(), false))

  router.object(
    "PUT",
    (call) => copyObject(call, s3(), clock),
    (c) => c.req.header("x-amz-copy-source") !== undefined,
  )

  router.object(
    "PUT",
    ({ c, bucket, key }) => {
      const object = requireObject(s3(), bucket, key)

      s3().objects.update(object.id, { acl: aclFrom(c, object.acl) })

      return c.body(null, 200)
    },
    hasQuery("acl"),
  )

  router.object("PUT", (call) => putObject(call, s3(), clock))

  router.object("DELETE", ({ c, bucket, key }) => {
    requireBucket(s3(), bucket)

    const object = objectAt(s3(), bucket, key)

    if (object) s3().objects.delete(object.id)

    return c.body(null, 204)
  })

  router.bucket("POST", ({ c, bucket }) => postForm(c, bucket, s3(), clock))
}
