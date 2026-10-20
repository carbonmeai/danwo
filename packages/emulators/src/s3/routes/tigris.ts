/**
 * Tigris's own additions to the S3 API on its endpoint, beside the S3 operations: the presign
 * call (`POST /?func=presign`), which the Tigris SDK's `getPresignedUrl` asks the service to make
 * instead of signing locally. It answers with a presigned S3 URL for the bucket and key named.
 */
import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import type { S3RouteContext } from "../context.ts"
import { badRequest, isTigrisHost, S3Error } from "../helpers.ts"
import { presignUrl } from "../sigv4.ts"
import { s3Store } from "../store.ts"
import { requireBucket } from "./buckets.ts"

/** The stand-in secret the presign answer carries when no key is seeded. */
const ANY_SECRET = "tsec_emulated"

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** An object key as a URL path, each segment encoded and the slashes kept. */
function keyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

/**
 * Where an object is reached from `endpoint`: virtual-hosted on a Tigris host, as Tigris answers,
 * and path-style on any other (the emulator's own address in a test).
 */
function objectUrl(endpoint: URL, bucket: string, key: string): string {
  return isTigrisHost(endpoint.hostname)
    ? `https://${bucket}.${endpoint.host}/${keyPath(key)}`
    : `${endpoint.origin}/${bucket}/${keyPath(key)}`
}

/** `POST /?func=presign`: a presigned GET or PUT URL for one object, made by the service. */
async function presign(c: Context, { store, clock }: S3RouteContext): Promise<Response> {
  const request = asRecord(JSON.parse((await c.req.text()) || "{}")) ?? {}
  const bucket = text(request["bucket"])
  const key = text(request["key"])
  const type = text(request["type"])
  const keyId = text(request["key_id"])

  if (type !== "get" && type !== "put")
    throw badRequest("InvalidArgument", "type must be get or put")

  requireBucket(s3Store(store), bucket)

  const secret = s3Store(store).keys.findOneBy("accessKeyId", keyId)?.secretAccessKey ?? ANY_SECRET
  const url = presignUrl(
    type.toUpperCase(),
    objectUrl(new URL(c.req.url), bucket, key),
    { accessKeyId: keyId, secretAccessKey: secret },
    { region: "auto" },
    Number(request["expires_in"] ?? 3600),
    clock(),
  )

  return c.json({
    bucket,
    key,
    type,
    url,
    custom_domain_url: "",
    key_id: keyId,
    key_secret: secret,
  })
}

/** Tigris's service-level calls on its endpoint. */
export function tigrisRoutes(context: S3RouteContext): void {
  context.router.service("POST", (c) => {
    if (c.req.query("func") !== "presign")
      throw new S3Error(
        "MethodNotAllowed",
        "The specified method is not allowed against this resource.",
        405,
      )

    return presign(c, context)
  })
}
