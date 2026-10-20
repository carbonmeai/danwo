import type { Store } from "../store.ts"
import type {
  AccessKeyRecord,
  BucketRecord,
  ObjectContent,
  ObjectRecord,
  PartRecord,
  UploadRecord,
} from "./entities.ts"

/** The S3 state held in an emulator's store. */
export function s3Store(store: Store) {
  return {
    buckets: store.collection<BucketRecord>("s3.buckets", ["name"]),
    objects: store.collection<ObjectRecord>("s3.objects", ["bucket", "path"]),
    uploads: store.collection<UploadRecord>("s3.uploads", ["uploadId"]),
    parts: store.collection<PartRecord>("s3.parts", ["uploadId"]),
    keys: store.collection<AccessKeyRecord>("s3.keys", ["accessKeyId"]),
  }
}

export type S3Store = ReturnType<typeof s3Store>

/** Where an object lives, as one indexed value: `<bucket>/<key>`. */
const pathOf = (bucket: string, key: string) => `${bucket}/${key}`

export const bucketNamed = (s3: S3Store, name: string): BucketRecord | undefined =>
  s3.buckets.findOneBy("name", name)

export const objectAt = (s3: S3Store, bucket: string, key: string): ObjectRecord | undefined =>
  s3.objects.findOneBy("path", pathOf(bucket, key))

/** Writes an object, replacing any at the same key, as S3 does without versioning. */
export function storeObject(
  s3: S3Store,
  bucket: string,
  key: string,
  content: ObjectContent,
): ObjectRecord {
  const current = objectAt(s3, bucket, key)
  const replaced = current && s3.objects.update(current.id, content)

  return replaced ?? s3.objects.insert({ bucket, key, path: pathOf(bucket, key), ...content })
}

export function objectBytes(object: Pick<ObjectContent, "body">): Buffer {
  return Buffer.from(object.body, "base64")
}
