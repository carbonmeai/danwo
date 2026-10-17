import type { Context, Middleware } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import { resolveAddress, type S3Address, S3Error } from "./helpers.ts"

export interface S3BucketCall {
  readonly c: Context
  readonly bucket: string
}

export interface S3ObjectCall extends S3BucketCall {
  readonly key: string
}

type Result = Response | Promise<Response>
/** Picks one operation among those sharing a method and level, e.g. `?uploads` on POST. */
type When = (c: Context) => boolean

/**
 * Registers S3 operations, the way Stripe's routes register on `app`. S3 cannot route by path
 * alone: the bucket may be in the host, and the operation depends on the query (`?uploads`,
 * `?uploadId`, `?list-type=2`) and headers (`x-amz-copy-source`). Operations with a `when` are
 * tried before the plain one for the same method and level.
 */
export interface S3Router {
  service(method: string, handler: (c: Context) => Result): void
  bucket(method: string, handler: (call: S3BucketCall) => Result, when?: When): void
  object(method: string, handler: (call: S3ObjectCall) => Result, when?: When): void
}

export interface S3RouteContext {
  readonly router: S3Router
  readonly store: Store
  readonly clock: Clock
  readonly baseUrl: string
}

type Level = "service" | "bucket" | "object"

interface Operation {
  readonly method: string
  readonly level: Level
  readonly when: When | undefined
  readonly run: (c: Context, address: S3Address) => Result
}

/** Subresources this emulator does not implement: answered 501 rather than as a plain GET/PUT. */
const UNSUPPORTED = [
  "accelerate",
  "analytics",
  "attributes",
  "cors",
  "encryption",
  "intelligent-tiering",
  "inventory",
  "legal-hold",
  "lifecycle",
  "logging",
  "metrics",
  "notification",
  "object-lock",
  "ownershipControls",
  "policy",
  "publicAccessBlock",
  "replication",
  "requestPayment",
  "restore",
  "retention",
  "select",
  "tagging",
  "torrent",
  "versioning",
  "versions",
  "website",
]

function levelOf(address: S3Address): Level {
  if (address.bucket === undefined) return "service"

  return address.key === undefined ? "bucket" : "object"
}

function notImplemented(c: Context): S3Error | undefined {
  const query = new URL(c.req.url).searchParams
  const name = UNSUPPORTED.find((s) => query.has(s))

  return name === undefined
    ? undefined
    : new S3Error("NotImplemented", `The ?${name} subresource is not emulated.`, 501)
}

function pick(operations: readonly Operation[], c: Context, level: Level): Operation | undefined {
  const candidates = operations.filter((o) => o.method === c.req.method && o.level === level)

  return candidates.find((o) => o.when?.(c)) ?? candidates.find((o) => o.when === undefined)
}

export function createS3Router(ownHost: string): {
  router: S3Router
  dispatch: Middleware
} {
  const operations: Operation[] = []
  const add = (method: string, level: Level, when: When | undefined, run: Operation["run"]) =>
    operations.push({ method, level, when, run })

  const router: S3Router = {
    service: (method, handler) => add(method, "service", undefined, (c) => handler(c)),
    bucket: (method, handler, when) =>
      add(method, "bucket", when, (c, a) => handler({ c, bucket: a.bucket ?? "" })),
    object: (method, handler, when) =>
      add(method, "object", when, (c, a) =>
        handler({ c, bucket: a.bucket ?? "", key: a.key ?? "" }),
      ),
  }

  const dispatch: Middleware = (c) => {
    const address = resolveAddress(new URL(c.req.url), ownHost)
    const operation = pick(operations, c, levelOf(address))

    if (!operation || (operation.when === undefined && notImplemented(c)))
      throw (
        notImplemented(c) ??
        new S3Error(
          "MethodNotAllowed",
          "The specified method is not allowed against this resource.",
          405,
        )
      )

    return operation.run(c, address)
  }

  return { router, dispatch }
}
