const json = { "content-type": "application/json" }

const envelope = (code: string, message: string) => JSON.stringify({ error: { code, message } })

const COMMON = [
  {
    kind: "status",
    status: 500,
    headers: json,
    body: envelope("server_error", "An unexpected error occurred"),
  },
  { kind: "reset" },
] as const

/**
 * What a proxied call or an action can meet: the provider rate limiting the call (Nango passes the
 * provider's answer on), the connection's token failing to refresh, a slow provider, and a dropped
 * answer after the provider acted.
 */
const PROXY_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { ...json, "retry-after": "2" },
    body: JSON.stringify({ error: "rate_limited" }),
  },
  {
    kind: "status",
    status: 424,
    headers: json,
    body: envelope(
      "refresh_token_external_error",
      "The external API returned an error when trying to refresh the access token. Please try again later.",
    ),
  },
  { kind: "delay", ms: 30_000 },
  ...COMMON,
  { kind: "reset-after" },
] as const

/**
 * `danwo matrix`'s Nango faults: the full set on the proxy and actions, a refresh failure on
 * reading a connection's credentials, server errors on other calls; the Connect UI is left alone.
 */
export function nangoOutboundFaults(call: { host?: string; method: string; path: string }) {
  if (call.host === "connect.nango.dev") return []
  if (call.path.startsWith("/proxy/") || call.path === "/action/trigger") return PROXY_FAULTS
  if (call.method === "GET" && /^\/connections?\/[^/]+$/.test(call.path))
    return [PROXY_FAULTS[1], ...COMMON]

  return COMMON
}
