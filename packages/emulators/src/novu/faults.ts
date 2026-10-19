const json = { "content-type": "application/json" }

/** Novu's error body, which `@novu/api` turns into a typed error. */
const error = (status: number, message: string) =>
  JSON.stringify({
    statusCode: status,
    message,
    error: message,
    timestamp: new Date(0).toISOString(),
    path: "/",
  })

const COMMON = [
  { kind: "status", status: 500, headers: json, body: error(500, "Internal server error") },
  { kind: "reset" },
] as const

/**
 * `danwo matrix`'s Novu faults: on triggering a workflow, a rate limit, a server error, and an
 * answer lost after Novu queued the run (a retry triggers it twice); on other server calls, a
 * server error and a dropped connection. The Inbox's session gets a server error, so the bell
 * has to cope with no session. The realtime socket gets the matrix's socket faults.
 */
export function novuOutboundFaults(call: { method: string; path: string }) {
  if (call.method === "POST" && call.path.startsWith("/v1/events/trigger"))
    return [
      {
        kind: "status",
        status: 429,
        headers: { ...json, "retry-after": "1" },
        body: error(429, "Too many requests"),
      },
      ...COMMON,
      { kind: "reset-after" },
    ] as const
  if (call.path === "/v1/inbox/session") return [COMMON[0]] as const
  if (call.path.startsWith("/v1/inbox/")) return []
  if (call.path.startsWith("/v1/") || call.path.startsWith("/v2/")) return COMMON

  return []
}
