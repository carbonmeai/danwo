import { defineEmulator } from "../define.ts"
import type { Context } from "../http.ts"
import type { Store } from "../store.ts"
import { s3Credentials } from "./auth.ts"
import { createS3Router } from "./context.ts"
import type { Acl } from "./entities.ts"
import { errorDocument } from "./formatters.ts"
import { S3Error } from "./helpers.ts"
import { bucketRoutes, createBucket } from "./routes/buckets.ts"
import { multipartUploadRoutes } from "./routes/multipart-uploads.ts"
import { contentOf, objectRoutes } from "./routes/objects.ts"
import { s3Store, storeObject } from "./store.ts"

export { s3OutboundFaults } from "./faults.ts"
export { isS3Host, s3Hosts, TIGRIS_ENDPOINTS } from "./helpers.ts"
export { type S3Objects, s3Objects, type StoredObject } from "./inbox.ts"

/** An object to seed into a bucket. */
export type SeedObject = {
  readonly key: string
  readonly body: string | Uint8Array
  readonly contentType?: string
  readonly metadata?: Record<string, string>
  readonly acl?: Acl
}

/** Buckets (and objects in them) to load into an S3 emulator. */
export type S3SeedConfig = Partial<{
  readonly buckets: readonly {
    readonly name: string
    readonly region?: string
    readonly acl?: Acl
    readonly objects?: readonly SeedObject[]
  }[]
}>

/** Loads `config` into an S3 emulator's store; a bucket that exists keeps its settings. */
export function seedS3(store: Store, config: S3SeedConfig): void {
  const s3 = s3Store(store)

  for (const bucket of config.buckets ?? []) {
    createBucket(s3, bucket)

    for (const object of bucket.objects ?? [])
      storeObject(
        s3,
        bucket.name,
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
}

/** S3's error document, or nothing for a HEAD, whose errors carry no body. */
function errorResponse(c: Context, error: unknown): Response {
  const failure =
    error instanceof S3Error
      ? error
      : new S3Error("InternalError", "We encountered an internal error. Please try again.", 500)
  const requestId = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()

  if (c.req.method === "HEAD")
    return c.body(null, failure.status, { "x-amz-request-id": requestId })

  return c.body(errorDocument(failure.code, failure.message, requestId), failure.status, {
    "content-type": "application/xml",
    "x-amz-request-id": requestId,
  })
}

/**
 * Amazon S3 and Tigris object storage: buckets, objects, listing, copies, multipart uploads,
 * presigned URLs and browser form uploads, path-style or virtual-hosted.
 */
export const s3 = defineEmulator({
  name: "s3",
  setup({ app, store, clock, baseUrl }) {
    const ownHost = new URL(baseUrl).hostname
    const { router, dispatch } = createS3Router(ownHost)

    app.onError((error, c) => errorResponse(c, error))
    app.use(s3Credentials(store, clock, ownHost))
    app.use(dispatch)

    for (const register of [bucketRoutes, objectRoutes, multipartUploadRoutes])
      register({ router, store, clock, baseUrl })
  },
})
