import type { Context, Middleware } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import { accessDenied, resolveAddress, type S3Address, S3Error } from "./helpers.ts"
import { type ParsedSignature, parseSignature, signatureMatches } from "./sigv4.ts"
import { bucketNamed, objectAt, s3Store } from "./store.ts"

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
 * Checks the signature against the seeded secret of the key it names. With no keys seeded every
 * well-formed signature passes; with some, an unknown key and a wrong signature are refused as
 * S3 refuses them.
 */
async function checkSignature(c: Context, store: Store, parsed: ParsedSignature): Promise<void> {
  const keys = s3Store(store).keys

  if (keys.all().length === 0) return

  const key = keys.findOneBy("accessKeyId", parsed.accessKeyId)

  if (!key)
    throw new S3Error(
      "InvalidAccessKeyId",
      "The AWS Access Key Id you provided does not exist in our records.",
      403,
    )

  /*
   * A proxy in between may forward the body without the `Content-Length` it was signed with;
   * the length is then the body's own, as the service would have received it.
   */
  const length =
    parsed.signedHeaders.includes("content-length") && c.req.header("content-length") === undefined
      ? String((await c.req.arrayBuffer()).byteLength)
      : undefined
  const headerOf = (name: string) =>
    name === "content-length" && length !== undefined ? length : (c.req.header(name) ?? "")

  if (!signatureMatches(c.req.method, new URL(c.req.url), headerOf, parsed, key))
    throw new S3Error(
      "SignatureDoesNotMatch",
      "The request signature we calculated does not match the signature you provided. Check your key and signing method.",
      403,
    )
}

/**
 * S3's request check. A request must be signed with SigV4, in the `Authorization` header or as a
 * presigned URL (`X-Amz-Algorithm=AWS4-HMAC-SHA256`). Signatures are checked only for access keys
 * a seed names (`credentials`), so by default any key and secret work, as any well-formed key
 * does for the Stripe and Resend emulators. A presigned URL past `X-Amz-Date` + `X-Amz-Expires`
 * (by the emulator clock) is refused. Unsigned requests may only read objects whose ACL, or
 * bucket's ACL, is public-read, and post browser forms.
 */
export function s3Credentials(store: Store, clock: Clock, ownHost: string): Middleware {
  return async (c, next) => {
    const url = new URL(c.req.url)
    const parsed = parseSignature(url, (name) => c.req.header(name) ?? "")

    if (parsed?.presigned === true) checkPresignedExpiry(c, clock)
    if (parsed !== undefined) await checkSignature(c, store, parsed)
    if (parsed === undefined && !allowsAnonymous(c, store, resolveAddress(url, ownHost)))
      throw accessDenied()

    return next()
  }
}
