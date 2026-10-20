import { defineEmulator } from "../define.ts"
import type { Context, Middleware } from "../http.ts"
import type { Store } from "../store.ts"
import { s3Credentials } from "./auth.ts"
import { createS3Router } from "./context.ts"
import type { Acl } from "./entities.ts"
import { errorDocument } from "./formatters.ts"
import { resolveAddress, S3Error } from "./helpers.ts"
import { bucketRoutes, createBucket } from "./routes/buckets.ts"
import { multipartUploadRoutes } from "./routes/multipart-uploads.ts"
import { contentOf, objectRoutes } from "./routes/objects.ts"
import { tigrisRoutes } from "./routes/tigris.ts"
import { s3Store, storeObject } from "./store.ts"

export { s3OutboundFaults } from "./faults.ts"
export { isS3Host, isTigrisHost, s3Hosts, TIGRIS_ENDPOINTS } from "./helpers.ts"
export { type S3Objects, s3Objects, type StoredObject } from "./inbox.ts"
export {
  parseSignature,
  presignUrl,
  signatureMatches,
  type SigningKey,
  type SigningScope,
  signRequest,
} from "./sigv4.ts"

/** An object to seed into a bucket. */
export type SeedObject = {
  readonly key: string
  readonly body: string | Uint8Array
  readonly contentType?: string
  readonly metadata?: Record<string, string>
  readonly acl?: Acl
}

/** Buckets (and objects in them) to load into an S3 emulator, and the access keys it knows. */
export type S3SeedConfig = Partial<{
  readonly buckets: readonly {
    readonly name: string
    readonly region?: string
    readonly acl?: Acl
    readonly objects?: readonly SeedObject[]
  }[]
  /**
   * Access keys whose signatures are checked: a request signed with one of these must carry the
   * signature its secret makes, and once any is seeded an unknown key is refused
   * (InvalidAccessKeyId). Without any, every well-formed signature is accepted.
   */
  readonly credentials: readonly {
    readonly accessKeyId: string
    readonly secretAccessKey: string
  }[]
}>

/** Loads `config` into an S3 emulator's store; a bucket that exists keeps its settings. */
export function seedS3(store: Store, config: S3SeedConfig): void {
  const s3 = s3Store(store)

  for (const key of config.credentials ?? [])
    if (!s3.keys.findOneBy("accessKeyId", key.accessKeyId)) s3.keys.insert({ ...key })

  for (const bucket of config.buckets ?? []) {
    createBucket(s3, bucket)

    for (const object of bucket.objects ?? []) seedObject(store, bucket.name, object)
  }
}

/** Stores one seeded object, described with its defaults filled in. */
function seedObject(store: Store, bucket: string, object: SeedObject): void {
  storeObject(
    s3Store(store),
    bucket,
    object.key,
    contentOf(
      Buffer.from(object.body),
      {
        contentType: object.contentType ?? "binary/octet-stream",
        metadata: object.metadata ?? {},
        headers: {},
        acl: object.acl ?? "private",
      },
      store.clock,
    ),
  )
}

/** A request id in the form S3 gives one. */
function requestId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()
}

/**
 * S3's error document, naming the resource, bucket and key the request addressed; a HEAD's error
 * carries no body but keeps the document's type.
 */
function errorResponse(c: Context, error: unknown, ownHost: string): Response {
  const failure =
    error instanceof S3Error
      ? error
      : new S3Error("InternalError", "We encountered an internal error. Please try again.", 500)
  const id = requestId()
  const headers = { "content-type": "application/xml", "x-amz-request-id": id }

  if (c.req.method === "HEAD")
    return c.body(null, failure.status, { ...headers, "content-length": "0" })

  const url = new URL(c.req.url)
  const { bucket, key } = resolveAddress(url, ownHost)
  const body = errorDocument(failure.code, failure.message, id, {
    resource: url.pathname,
    bucket,
    key,
  })

  return c.body(body, failure.status, {
    ...headers,
    "content-length": String(Buffer.byteLength(body)),
  })
}

/** Whether a response carries no body by its status or method. */
function bodiless(c: Context, response: Response): boolean {
  return c.req.method === "HEAD" || response.status === 204 || response.status === 304
}

/**
 * Every answer carries an `x-amz-request-id`, and a `Content-Length` as S3 sends it over the
 * wire (`0` for an empty write answer), so SDKs and fidelity read the same headers either way.
 */
const responseHeaders: Middleware = async (c, next) => {
  const response = await next()
  const headers = new Headers(response.headers)

  if (!headers.has("x-amz-request-id")) headers.set("x-amz-request-id", requestId())
  if (bodiless(c, response) || headers.has("content-length"))
    return new Response(response.body, { status: response.status, headers })

  const bytes = new Uint8Array(await response.arrayBuffer())

  headers.set("content-length", String(bytes.length))

  return new Response(bytes.length === 0 ? null : bytes, { status: response.status, headers })
}

/**
 * Amazon S3 and Tigris object storage: buckets, objects, listing, copies, multipart uploads,
 * conditional requests, checksums, presigned URLs and browser form uploads, path-style or
 * virtual-hosted; and Tigris's presign call. A Tigris host is answered with Tigris's small
 * differences, any other with AWS's.
 */
export const s3 = defineEmulator({
  name: "s3",
  setup({ app, store, clock, baseUrl }) {
    const ownHost = new URL(baseUrl).hostname
    const { router, dispatch } = createS3Router(ownHost)

    app.onError((error, c) => errorResponse(c, error, ownHost))
    app.use(responseHeaders)
    app.use(s3Credentials(store, clock, ownHost))
    app.use(dispatch)

    for (const register of [bucketRoutes, objectRoutes, multipartUploadRoutes, tigrisRoutes])
      register({ router, store, clock, baseUrl })
  },
})
