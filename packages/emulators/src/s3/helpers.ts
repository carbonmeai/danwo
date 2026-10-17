import { createHash, randomBytes } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import type { Acl, ObjectHeaders } from "./entities.ts"

/** An S3 failure, answered with S3's error document: its code (`NoSuchKey`) names it. */
export class S3Error extends HttpError {
  readonly code: string

  constructor(code: string, message: string, status: number) {
    super(status, message)
    this.code = code
  }
}

export const noSuchBucket = () =>
  new S3Error("NoSuchBucket", "The specified bucket does not exist", 404)
export const noSuchKey = () => new S3Error("NoSuchKey", "The specified key does not exist.", 404)
export const accessDenied = (message = "Access Denied") => new S3Error("AccessDenied", message, 403)
export const badRequest = (code: string, message: string) => new S3Error(code, message, 400)

/** A quoted-hex MD5, the ETag of a single-part object. */
export function md5Hex(bytes: Uint8Array | string): string {
  return createHash("md5").update(bytes).digest("hex")
}

/** A multipart object's ETag: the MD5 of the parts' binary MD5s, then `-<count>`. */
export function multipartEtag(partEtags: readonly string[]): string {
  const joined = Buffer.concat(partEtags.map((etag) => Buffer.from(etag, "hex")))

  return `${md5Hex(joined)}-${partEtags.length}`
}

export function newUploadId(): string {
  return randomBytes(24).toString("base64url")
}

// --- addressing ---

/** Tigris's S3 endpoints: the current one and the earlier Fly one. */
export const TIGRIS_ENDPOINTS = ["t3.storage.dev", "fly.storage.tigris.dev"] as const

/** `s3.amazonaws.com`, `s3.eu-west-1.amazonaws.com`, `s3-us-west-2.amazonaws.com` and the like. */
const AWS_ENDPOINT = /(?:^|\.)(s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com)$/

/** Where a request points: its bucket and key, either of which may be absent. */
export interface S3Address {
  readonly bucket: string | undefined
  readonly key: string | undefined
}

/** The S3 endpoint a host is on, or itself under it (`media.t3.storage.dev`). */
function endpointOf(host: string): string | undefined {
  const tigris = TIGRIS_ENDPOINTS.find(
    (endpoint) => host === endpoint || host.endsWith(`.${endpoint}`),
  )

  return tigris ?? AWS_ENDPOINT.exec(host)?.[1]
}

/** Whether `host` is an S3 or Tigris endpoint, path-style or virtual-hosted. */
export function isS3Host(host: string): boolean {
  return endpointOf(host) !== undefined
}

/**
 * The bucket and key a URL addresses. On an S3 or Tigris host, a bucket in front of the endpoint
 * (`media.t3.storage.dev/a.txt`) is virtual-hosted style; anywhere else, and on the bare
 * endpoint, the first path segment is the bucket.
 */
export function resolveAddress(url: URL, ownHost: string): S3Address {
  const host = url.hostname
  const endpoint = host === ownHost ? undefined : endpointOf(host)
  const segments = url.pathname.split("/").slice(1).map(decodeURIComponent)
  const virtual =
    endpoint !== undefined && host !== endpoint ? host.slice(0, -endpoint.length - 1) : undefined
  const [bucket, ...rest] = virtual === undefined ? segments : [virtual, ...segments]
  const key = rest.join("/")

  return { bucket: bucket || undefined, key: key || undefined }
}

/** The hosts to route to the emulator for `buckets`: each endpoint and `<bucket>.<endpoint>`. */
export function s3Hosts(
  buckets: readonly string[],
  endpoints: readonly string[] = [...TIGRIS_ENDPOINTS, "s3.amazonaws.com"],
): string[] {
  return endpoints.flatMap((endpoint) => [
    endpoint,
    ...buckets.map((bucket) => `${bucket}.${endpoint}`),
  ])
}

// --- request reading ---

/** Undoes `aws-chunked` framing: `<hex size>[;ext]\r\n<bytes>\r\n` … `0\r\n` and trailers. */
function unchunk(framed: Buffer): Buffer {
  const pieces: Buffer[] = []
  let at = 0

  for (;;) {
    const lineEnd = framed.indexOf("\r\n", at)
    const size = Number.parseInt(
      framed.subarray(at, lineEnd).toString("latin1").split(";")[0] ?? "",
      16,
    )

    if (lineEnd < 0 || !Number.isFinite(size) || size === 0) return Buffer.concat(pieces)

    pieces.push(framed.subarray(lineEnd + 2, lineEnd + 2 + size))
    at = lineEnd + 2 + size + 2
  }
}

/** The object bytes a request carries, with the SDK's streaming framing removed. */
export async function readBody(c: Context): Promise<Buffer> {
  const raw = Buffer.from(await c.req.arrayBuffer())
  const encoding = c.req.header("content-encoding") ?? ""
  const hashing = c.req.header("x-amz-content-sha256") ?? ""

  return encoding.includes("aws-chunked") || hashing.startsWith("STREAMING-") ? unchunk(raw) : raw
}

/** `x-amz-meta-*` headers as metadata, keyed without the prefix. */
export function metadataFrom(c: Context): Record<string, string> {
  return Object.fromEntries(
    Object.entries(c.req.header())
      .filter(([name]) => name.startsWith("x-amz-meta-"))
      .map(([name, value]) => [name.slice("x-amz-meta-".length), value]),
  )
}

const KEPT_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "expires",
] as const

/** The response headers a write asks S3 to store with the object. */
export function headersFrom(c: Context): ObjectHeaders {
  const kept: ObjectHeaders = {}

  for (const name of KEPT_HEADERS) {
    const value = c.req.header(name)

    if (value && !(name === "content-encoding" && value.includes("aws-chunked"))) kept[name] = value
  }

  return kept
}

const ACLS: readonly string[] = ["private", "public-read", "public-read-write"]

/** The canned ACL in `x-amz-acl`, or `fallback`. */
export function aclFrom(c: Context, fallback: Acl = "private"): Acl {
  const wanted = c.req.header("x-amz-acl")

  return wanted && ACLS.includes(wanted) ? (wanted as Acl) : fallback
}

export function contentTypeFrom(c: Context): string {
  return c.req.header("content-type") ?? "binary/octet-stream"
}

/** Matches requests that carry the query parameter `name` (with or without a value). */
export const hasQuery =
  (name: string) =>
  (c: Context): boolean =>
    new URL(c.req.url).searchParams.has(name)

/** Every `<tag>…</tag>` text in a small XML request body. */
export function xmlTexts(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) =>
    (match[1] ?? "")
      .replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  )
}
