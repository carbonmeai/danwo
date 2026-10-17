import type { Context, Middleware } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import { accessDenied, resolveAddress, type S3Address } from "./helpers.ts"
import { bucketNamed, objectAt, s3Store } from "./store.ts"

type Signature = "header" | "presigned" | "none"

function signatureOf(c: Context): Signature {
  if ((c.req.header("authorization") ?? "").startsWith("AWS4-HMAC-SHA256 ")) return "header"
  if (c.req.query("X-Amz-Algorithm") === "AWS4-HMAC-SHA256") return "presigned"

  return "none"
}

/** `20261017T120000Z` to epoch milliseconds. */
function amzDate(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)

  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : Number.NaN
}

function checkPresignedExpiry(c: Context, clock: Clock): void {
  const signedAt = amzDate(c.req.query("X-Amz-Date") ?? "")
  const expires = Number(c.req.query("X-Amz-Expires") ?? "")

  if (!Number.isFinite(signedAt) || !Number.isFinite(expires))
    throw accessDenied("Query-string authentication requires X-Amz-Date and X-Amz-Expires.")
  if (clock().getTime() > signedAt + expires * 1000) throw accessDenied("Request has expired")
}

const readable = (acl: string | undefined) => acl === "public-read" || acl === "public-read-write"

function isPublicRead(store: Store, { bucket, key }: S3Address): boolean {
  if (bucket === undefined || key === undefined) return false
  const s3 = s3Store(store)

  return readable(objectAt(s3, bucket, key)?.acl) || readable(bucketNamed(s3, bucket)?.acl)
}

/** Browser form uploads (POST to a bucket) carry their own policy; public objects can be read. */
function allowsAnonymous(c: Context, store: Store, address: S3Address): boolean {
  const method = c.req.method

  if (method === "POST" && address.bucket !== undefined && address.key === undefined) return true

  return (method === "GET" || method === "HEAD") && isPublicRead(store, address)
}

/**
 * S3's request check. A request must be signed with SigV4, in the `Authorization` header or as a
 * presigned URL (`X-Amz-Algorithm=AWS4-HMAC-SHA256`). The signature itself is not verified, so
 * any access key and secret work, as any well-formed key does for the Stripe and Resend
 * emulators. A presigned URL past `X-Amz-Date` + `X-Amz-Expires` (by the emulator clock) is
 * refused. Unsigned requests may only read objects whose ACL, or bucket's ACL, is public-read,
 * and post browser forms.
 */
export function s3Credentials(store: Store, clock: Clock, ownHost: string): Middleware {
  return async (c, next) => {
    const signature = signatureOf(c)

    if (signature === "presigned") checkPresignedExpiry(c, clock)
    if (
      signature === "none" &&
      !allowsAnonymous(c, store, resolveAddress(new URL(c.req.url), ownHost))
    )
      throw accessDenied()

    return next()
  }
}
