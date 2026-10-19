const json = { "content-type": "application/json" }
const text = { "content-type": "text/plain; charset=utf-8" }

/** What any Channels API call can meet: a server error and a dropped connection. */
const CHANNELS = [
  { kind: "status", status: 500, headers: text, body: "Internal Server Error" },
  { kind: "reset" },
] as const

/**
 * Triggering an event can also be rate limited, and can be accepted with the answer lost on the
 * way back, so a retry publishes it twice.
 */
const TRIGGER = [
  { kind: "status", status: 429, headers: text, body: "Rate limit exceeded" },
  ...CHANNELS,
  { kind: "reset-after" },
] as const

/** Beams' errors, in the `{ error, description }` shape its server SDK reads. */
const BEAMS = [
  {
    kind: "status",
    status: 429,
    headers: json,
    body: JSON.stringify({ error: "Too Many Requests", description: "Rate limit exceeded" }),
  },
  {
    kind: "status",
    status: 500,
    headers: json,
    body: JSON.stringify({ error: "Internal Server Error", description: "Something went wrong" }),
  },
  { kind: "reset" },
] as const

/**
 * `danwo matrix`'s Pusher faults on HTTP calls: rate limits, server errors and dropped answers on
 * triggering events, plain failures on the rest of the Channels API, and Beams' rate limit and
 * server error on publishing. Sockets get the matrix's own faults (refused upgrade, dropped
 * connection) wherever the clean run opened one.
 */
export function pusherOutboundFaults(call: { host: string; method: string; path: string }) {
  if (call.host.endsWith(".pushnotifications.pusher.com"))
    return call.path.includes("/publishes/") ? BEAMS : []
  if (call.method === "POST" && /^\/apps\/[^/]+\/(batch_)?events$/.test(call.path)) return TRIGGER
  if (call.path.startsWith("/apps/")) return CHANNELS

  return []
}
