import type { Emulator } from "../define.ts"
import type { ObjectRecord } from "./entities.ts"
import { objectAt, objectBytes, s3Store } from "./store.ts"

/** One object the emulator holds, as a test reads it. */
export interface StoredObject {
  readonly bucket: string
  readonly key: string
  readonly size: number
  readonly contentType: string
  /** Without the quotes S3 puts around it in headers. */
  readonly etag: string
  readonly metadata: Readonly<Record<string, string>>
  readonly acl: string
  readonly lastModified: string
  bytes(): Buffer
  text(): string
}

export interface S3Objects {
  /** Bucket names, in creation order. */
  buckets(): string[]
  /** Objects in `bucket` in key order, only keys starting with `prefix` when given. */
  list(bucket: string, prefix?: string): StoredObject[]
  get(bucket: string, key: string): StoredObject | undefined
}

function asStoredObject(object: ObjectRecord): StoredObject {
  return {
    bucket: object.bucket,
    key: object.key,
    size: object.size,
    contentType: object.contentType,
    etag: object.etag,
    metadata: object.metadata,
    acl: object.acl,
    lastModified: object.modified,
    bytes: () => objectBytes(object),
    text: () => objectBytes(object).toString("utf8"),
  }
}

/** What the S3 emulator holds, read the way a test inspects a bucket. */
export function s3Objects(emulator: Pick<Emulator, "store">): S3Objects {
  const s3 = () => s3Store(emulator.store)

  return {
    buckets: () =>
      s3()
        .buckets.all()
        .map((bucket) => bucket.name),
    list: (bucket, prefix = "") =>
      s3()
        .objects.findBy("bucket", bucket)
        .filter((object) => object.key.startsWith(prefix))
        .toSorted((a, b) => a.key.localeCompare(b.key, "en"))
        .map(asStoredObject),
    get: (bucket, key) => {
      const object = objectAt(s3(), bucket, key)

      return object && asStoredObject(object)
    },
  }
}
