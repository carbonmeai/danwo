import { errorBody } from "./helpers.ts"

const json = { "content-type": "application/json" }

/** A status fault whose body is Bachs's error object, as its SDK reads it into a `BachsApiError`. */
function status(
  httpStatus: number,
  code: string,
  detail: string,
  extra: Record<string, string> = {},
) {
  return {
    kind: "status",
    status: httpStatus,
    headers: { ...json, ...extra },
    body: JSON.stringify(errorBody(code, detail)),
  } as const
}

const RATE_LIMITED = status(429, "TOO_MANY_REQUESTS", "Too many requests", { "retry-after": "5" })
const BROKEN = status(500, "INTERNAL_SERVER_ERROR", "Internal server error")
const UNAVAILABLE = status(503, "SERVICE_UNAVAILABLE", "Service unavailable")

/** Whether a call changes something: it creates, updates, cancels or pays out. */
function isWrite(call: { method: string }): boolean {
  return call.method === "POST" || call.method === "PATCH" || call.method === "DELETE"
}

/**
 * Failures a call to the Bachs API can meet, as the fault matrix injects them at the proxy: rate
 * limiting (with `Retry-After`), Bachs failing or unavailable, a slow answer and a dropped
 * connection. Calls that change something also get a connection dropped after Bachs acted, the
 * "uncertain write" the docs ask apps to reconcile before retrying with a new key. Pages on the
 * checkout and portal hosts are left alone: they are the buyer's, not the app's.
 */
export function bachsOutboundFaults(call: { method: string; host?: string }) {
  if (call.host === "checkout.bachs.io" || call.host === "portal.bachs.io") return []

  const reads = [RATE_LIMITED, BROKEN, { kind: "reset" }] as const

  if (!isWrite(call)) return reads

  return [
    RATE_LIMITED,
    BROKEN,
    UNAVAILABLE,
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
  ] as const
}
