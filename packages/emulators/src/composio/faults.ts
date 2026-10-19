const json = { "content-type": "application/json" }

/** Composio's error envelope, as the SDK parses it into a typed API error. */
const envelope = (status: number, code: number, slug: string, message: string) =>
  JSON.stringify({
    error: { message, code, slug, status, request_id: "req_danwo_fault", suggested_fix: "" },
  })

const EXECUTE = /^\/api\/v3(\.1)?\/tools\/execute\/[^/]+$/
const CONNECT = /^\/api\/v3(\.1)?\/connected_accounts(\/link)?$/

/** What every API call can meet: a server error and a dropped connection. */
const COMMON = [
  {
    kind: "status",
    status: 500,
    headers: json,
    body: envelope(500, 500, "Internal_ServerError", "Internal server error"),
  },
  { kind: "reset" },
] as const

/**
 * The failures a tool call can meet, which an agent has to survive: rate limiting (with a
 * `retry-after`), the provider being down, Composio's own timeout, the account's credentials
 * having expired, and a run Composio carried out that the provider refused (`successful: false`
 * on a 200, which the SDK hands back rather than throws). A delay checks the app's own timeout; a
 * reset after Composio acted checks that a retry does not do the thing twice. The codes and
 * wording are approximations.
 */
const EXECUTE_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { ...json, "retry-after": "2" },
    body: envelope(
      429,
      1103,
      "Tool_RateLimitExceeded",
      "Rate limit exceeded for this tool, retry later",
    ),
  },
  {
    kind: "status",
    status: 503,
    headers: json,
    body: envelope(
      503,
      1104,
      "Tool_UpstreamUnavailable",
      "The toolkit's API is currently unavailable",
    ),
  },
  {
    kind: "status",
    status: 408,
    headers: json,
    body: envelope(
      408,
      1105,
      "Tool_ExecutionTimeout",
      "Tool execution exceeded the maximum allowed time",
    ),
  },
  {
    kind: "status",
    status: 422,
    headers: json,
    body: envelope(
      422,
      1406,
      "ConnectedAccount_Expired",
      "The connected account's credentials have expired",
    ),
  },
  {
    kind: "status",
    status: 200,
    headers: json,
    body: JSON.stringify({
      data: {},
      error: "The toolkit's API refused the request",
      successful: false,
      log_id: "log_danwo_fault",
    }),
  },
  { kind: "delay", ms: 30_000 },
  ...COMMON,
  { kind: "reset-after" },
] as const

/**
 * `danwo matrix`'s Composio faults: the full set on tool execution, rate limiting and a server
 * error on starting a connection, and plain server failures on other API calls; the hosted link
 * and the OAuth callback the browser visits are left alone.
 */
export function composioOutboundFaults(call: { method: string; path: string }) {
  /* The browser's hosted link and OAuth callback are pages, not API calls an app makes. */
  if (call.path.startsWith("/link/") || call.path.endsWith("/toolkits/auth/callback")) return []
  if (call.method === "POST" && EXECUTE.test(call.path) && !call.path.endsWith("/proxy"))
    return EXECUTE_FAULTS
  if (call.method === "POST" && CONNECT.test(call.path))
    return [
      {
        kind: "status",
        status: 429,
        headers: { ...json, "retry-after": "2" },
        body: envelope(429, 1003, "RateLimit_Exceeded", "Too many requests, retry later"),
      },
      ...COMMON,
    ] as const

  return COMMON
}
