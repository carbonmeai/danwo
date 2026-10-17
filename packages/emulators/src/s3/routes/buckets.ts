import type { Context } from "../../http.ts"
import type { S3RouteContext } from "../context.ts"
import type { Acl, BucketRecord, ObjectRecord } from "../entities.ts"
import { bucketList, bucketLocation, deleteResult, document, listedObject } from "../formatters.ts"
import { aclFrom, badRequest, hasQuery, noSuchBucket, S3Error, xmlTexts } from "../helpers.ts"
import { bucketNamed, objectAt, type S3Store, s3Store } from "../store.ts"

const xml = (c: Context, body: string, status = 200) =>
  c.body(body, status, { "content-type": "application/xml" })

/** S3's naming rule: 3 to 63 lower-case letters, digits, dots and dashes, alphanumeric at the ends. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

/** Adds a bucket unless one by that name exists. */
export function createBucket(
  s3: S3Store,
  bucket: {
    readonly name: string
    readonly region?: string | undefined
    readonly acl?: Acl | undefined
  },
): void {
  if (bucketNamed(s3, bucket.name)) return

  s3.buckets.insert({
    name: bucket.name,
    region: bucket.region ?? "us-east-1",
    acl: bucket.acl ?? "private",
  })
}

/** The bucket called `name`; S3's NoSuchBucket when there is none. */
export function requireBucket(s3: S3Store, name: string): BucketRecord {
  const bucket = bucketNamed(s3, name)

  if (!bucket) throw noSuchBucket()

  return bucket
}

/** One entry of a listing: a key, or a prefix that rolls up the keys under it. */
type Entry =
  | { readonly at: string; readonly object: ObjectRecord }
  | { readonly at: string; readonly prefix: string }

interface Listing {
  readonly prefix: string
  readonly delimiter: string
  readonly maxKeys: number
  /** List entries after this key or prefix. */
  readonly after: string
}

/** Keys under `prefix` in key order, with those past the delimiter rolled up into one prefix each. */
function entriesOf(objects: readonly ObjectRecord[], listing: Listing): Entry[] {
  const entries = new Map<string, Entry>()
  const sorted = objects
    .filter((o) => o.key.startsWith(listing.prefix))
    .toSorted((a, b) => (a.key < b.key ? -1 : 1))

  for (const object of sorted) {
    const cut = listing.delimiter
      ? object.key.indexOf(listing.delimiter, listing.prefix.length)
      : -1
    const prefix = cut >= 0 ? object.key.slice(0, cut + listing.delimiter.length) : undefined

    if (prefix === undefined) entries.set(object.key, { at: object.key, object })
    else if (!entries.has(prefix)) entries.set(prefix, { at: prefix, prefix })
  }

  return [...entries.values()]
}

/** One page of a listing; `last` is where the next page starts when the listing is truncated. */
function pageOf(objects: readonly ObjectRecord[], listing: Listing) {
  const entries = entriesOf(objects, listing).filter((entry) => entry.at > listing.after)
  const page = entries.slice(0, listing.maxKeys)
  const truncated = entries.length > listing.maxKeys

  return {
    contents: page.flatMap((entry) => ("object" in entry ? [listedObject(entry.object)] : [])),
    prefixes: page.flatMap((entry) => ("prefix" in entry ? [{ Prefix: entry.prefix }] : [])),
    truncated,
    last: truncated ? page.at(-1)?.at : undefined,
  }
}

function listingFrom(c: Context, after: string): Listing {
  const maxKeys = Number(c.req.query("max-keys") ?? 1000)

  return {
    prefix: c.req.query("prefix") ?? "",
    delimiter: c.req.query("delimiter") ?? "",
    maxKeys: Number.isInteger(maxKeys) && maxKeys >= 0 ? Math.min(maxKeys, 1000) : 1000,
    after,
  }
}

const token = {
  write: (at: string) => Buffer.from(at, "utf8").toString("base64url"),
  read: (value: string) => Buffer.from(value, "base64url").toString("utf8"),
}

/** ListObjectsV2: continuation tokens, `start-after`, and `KeyCount` counting prefixes too. */
function listV2(c: Context, bucket: string, objects: readonly ObjectRecord[]): Response {
  const continuation = c.req.query("continuation-token")
  const startAfter = c.req.query("start-after")
  const listing = listingFrom(c, continuation ? token.read(continuation) : (startAfter ?? ""))
  const page = pageOf(objects, listing)

  return xml(
    c,
    document("ListBucketResult", {
      Name: bucket,
      Prefix: listing.prefix,
      Delimiter: listing.delimiter || undefined,
      MaxKeys: listing.maxKeys,
      KeyCount: page.contents.length + page.prefixes.length,
      IsTruncated: page.truncated,
      ContinuationToken: continuation,
      NextContinuationToken: page.last === undefined ? undefined : token.write(page.last),
      StartAfter: startAfter,
      Contents: page.contents,
      CommonPrefixes: page.prefixes,
    }),
  )
}

/** ListObjects (v1): `marker`, and `NextMarker` when a delimiter is used. */
function listV1(c: Context, bucket: string, objects: readonly ObjectRecord[]): Response {
  const marker = c.req.query("marker") ?? ""
  const listing = listingFrom(c, marker)
  const page = pageOf(objects, listing)

  return xml(
    c,
    document("ListBucketResult", {
      Name: bucket,
      Prefix: listing.prefix,
      Marker: marker,
      Delimiter: listing.delimiter || undefined,
      MaxKeys: listing.maxKeys,
      IsTruncated: page.truncated,
      NextMarker: listing.delimiter ? page.last : undefined,
      Contents: page.contents,
      CommonPrefixes: page.prefixes,
    }),
  )
}

/** Bucket operations, the account's bucket list, and listing and deleting objects in bulk. */
export function bucketRoutes({ router, store }: S3RouteContext): void {
  const s3 = () => s3Store(store)
  const existing = (name: string) => requireBucket(s3(), name)

  router.service("GET", (c) => xml(c, bucketList(s3().buckets.all())))

  router.bucket("PUT", async ({ c, bucket }) => {
    if (!BUCKET_NAME.test(bucket))
      throw badRequest("InvalidBucketName", "The specified bucket is not valid.")
    if (bucketNamed(s3(), bucket))
      throw new S3Error(
        "BucketAlreadyOwnedByYou",
        "Your previous request to create the named bucket succeeded and you already own it.",
        409,
      )

    const region = xmlTexts(await c.req.text(), "LocationConstraint")[0] || undefined

    createBucket(s3(), { name: bucket, region, acl: aclFrom(c) })

    return c.body(null, 200, { location: `/${bucket}` })
  })

  router.bucket("HEAD", ({ c, bucket }) =>
    c.body(null, 200, { "x-amz-bucket-region": existing(bucket).region }),
  )

  router.bucket(
    "GET",
    ({ c, bucket }) => xml(c, bucketLocation(existing(bucket).region)),
    hasQuery("location"),
  )

  router.bucket(
    "GET",
    ({ c, bucket }) => listV2(c, existing(bucket).name, s3().objects.findBy("bucket", bucket)),
    (c) => c.req.query("list-type") === "2",
  )

  router.bucket("GET", ({ c, bucket }) =>
    listV1(c, existing(bucket).name, s3().objects.findBy("bucket", bucket)),
  )

  router.bucket("DELETE", ({ c, bucket }) => {
    const found = existing(bucket)

    if (s3().objects.findBy("bucket", bucket).length > 0)
      throw new S3Error("BucketNotEmpty", "The bucket you tried to delete is not empty", 409)

    s3().buckets.delete(found.id)

    return c.body(null, 204)
  })

  router.bucket(
    "POST",
    async ({ c, bucket }) => {
      existing(bucket)

      const keys = xmlTexts(await c.req.text(), "Key")

      for (const key of keys) {
        const object = objectAt(s3(), bucket, key)

        if (object) s3().objects.delete(object.id)
      }

      return xml(c, deleteResult(keys))
    },
    hasQuery("delete"),
  )
}
