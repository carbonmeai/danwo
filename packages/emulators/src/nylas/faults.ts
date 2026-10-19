const json = { "content-type": "application/json" }

/** Nylas's error envelope, as the SDK reads it into a `NylasApiError`. */
const envelope = (type: string, message: string) =>
  JSON.stringify({ request_id: "danwo-fault", error: { type, message } })

const COMMON = [
  { kind: "status", status: 500, headers: json, body: envelope("api_error", "Internal error") },
  { kind: "reset" },
] as const

/**
 * What a send or a write can meet: rate limiting, the mail provider refusing or failing the call
 * (Nylas passes its error on as `provider_error`), the grant's credentials having expired, and a
 * dropped answer after the message went out, which checks a retry does not send it twice.
 */
const WRITE_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { ...json, "retry-after": "2" },
    body: envelope("rate_limit_error", "Too many requests"),
  },
  {
    kind: "status",
    status: 401,
    headers: json,
    body: envelope(
      "token.unauthorized",
      "The grant's provider credentials are invalid; re-authenticate",
    ),
  },
  {
    kind: "status",
    status: 504,
    headers: json,
    body: JSON.stringify({
      request_id: "danwo-fault",
      error: {
        type: "provider_error",
        message: "The provider did not answer in time",
        provider_error: { error: "timeout" },
      },
    }),
  },
  { kind: "delay", ms: 30_000 },
  ...COMMON,
  { kind: "reset-after" },
] as const

const READ_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { ...json, "retry-after": "2" },
    body: envelope("rate_limit_error", "Too many requests"),
  },
  ...COMMON,
] as const

/**
 * `danwo matrix`'s Nylas faults: the full set on sends, bookings and other writes, rate limiting
 * and server errors on reads; the hosted auth page the browser visits is left alone, and the token
 * exchange gets a server error and a dropped connection.
 */
export function nylasOutboundFaults(call: { method: string; path: string }) {
  if (call.path.startsWith("/v3/connect/auth")) return []
  if (call.path.startsWith("/v3/connect/")) return COMMON
  if (call.method === "GET" || call.method === "HEAD") return READ_FAULTS

  return WRITE_FAULTS
}
