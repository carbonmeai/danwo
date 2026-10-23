import { createHash, randomBytes } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import { oneOf } from "../json.ts"
import {
  type Acl,
  CHECKSUM_ALGORITHMS,
  type ObjectChecksum,
  type ObjectHeaders,
} from "./entities.ts"

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
const AWS_ENDPOINT = /(?:^|\.)(s3(?:[.-][a-z0-9]+)*\.amazonaws\.com)$/

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
 * Whether `host` is on a Tigris endpoint. Tigris answers a few details differently from AWS
 * (an empty `Owner` in listings, a `ContinuationToken` element always present), and the emulator
 * answers each host the way its service does.
 */
export function isTigrisHost(host: string): boolean {
  return TIGRIS_ENDPOINTS.some((endpoint) => host === endpoint || host.endsWith(`.${endpoint}`))
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

/** The `name:value` trailer lines after an `aws-chunked` body's last chunk. */
function trailersOf(framed: Buffer, at: number): Record<string, string> {
  return Object.fromEntries(
    framed
      .subarray(at)
      .toString("latin1")
      .split("\r\n")
      .flatMap((line) => {
        const colon = line.indexOf(":")

        return colon > 0
          ? [[line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]]
          : []
      }),
  )
}

/** Undoes `aws-chunked` framing: `<hex size>[;ext]\r\n<bytes>\r\n` … `0\r\n`, then trailers. */
function unchunk(framed: Buffer): { bytes: Buffer; trailers: Record<string, string> } {
  const pieces: Buffer[] = []
  let at = 0

  for (;;) {
    const lineEnd = framed.indexOf("\r\n", at)
    const size = Number.parseInt(
      framed.subarray(at, lineEnd).toString("latin1").split(";")[0] ?? "",
      16,
    )

    if (lineEnd < 0 || !Number.isFinite(size) || size === 0)
      return {
        bytes: Buffer.concat(pieces),
        trailers: lineEnd < 0 ? {} : trailersOf(framed, lineEnd + 2),
      }

    pieces.push(framed.subarray(lineEnd + 2, lineEnd + 2 + size))
    at = lineEnd + 2 + size + 2
  }
}

/** What a write carries: its bytes, without the SDK's streaming framing, and its checksum. */
export interface WriteBody {
  readonly bytes: Buffer
  readonly checksum: ObjectChecksum | undefined
}

/** The first `x-amz-checksum-<algorithm>` among `values`, read from headers or trailers. */
function checksumIn(values: (name: string) => string | undefined): ObjectChecksum | undefined {
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    const value = values(`x-amz-checksum-${algorithm}`)

    if (value) return { algorithm, value }
  }

  return undefined
}

/** The bytes and checksum a write carries, in a plain or an `aws-chunked` body. */
export async function readWrite(c: Context): Promise<WriteBody> {
  const raw = Buffer.from(await c.req.arrayBuffer())
  const encoding = c.req.header("content-encoding") ?? ""
  const hashing = c.req.header("x-amz-content-sha256") ?? ""
  const chunked = encoding.includes("aws-chunked") || hashing.startsWith("STREAMING-")
  const { bytes, trailers } = chunked ? unchunk(raw) : { bytes: raw, trailers: {} }
  const headerOf = (name: string) => c.req.header(name)
  const trailerOf = (name: string): string | undefined => trailers[name]

  return { bytes, checksum: checksumIn(headerOf) ?? checksumIn(trailerOf) }
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

export const ACLS: readonly Acl[] = ["private", "public-read", "public-read-write"]

/** The canned ACL in `x-amz-acl`, or `fallback`. */
export function aclFrom(c: Context, fallback: Acl = "private"): Acl {
  return oneOf(ACLS, c.req.header("x-amz-acl"), fallback)
}

/** Whether the request came to a Tigris host, which answers a few details its own way. */
export function onTigris(c: Context): boolean {
  return isTigrisHost(new URL(c.req.url).hostname)
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
