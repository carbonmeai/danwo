import { managementErrorBody } from "./helpers.ts"

const json = { "content-type": "application/json; charset=utf-8" }

/** A status fault with an OAuth error body, as the authentication API answers. */
function oauthFault(
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
) {
  return {
    kind: "status",
    status,
    headers: { ...json, ...headers },
    body: JSON.stringify({ error, error_description: description }),
  } as const
}

/** A status fault with the Management API's error body. */
function managementFault(status: number, message: string, headers: Record<string, string> = {}) {
  return {
    kind: "status",
    status,
    headers: { ...json, ...headers },
    body: JSON.stringify(managementErrorBody(status, message)),
  } as const
}

const TOKEN_FAULTS = [
  oauthFault(429, "too_many_requests", "Too many requests", { "retry-after": "1" }),
  oauthFault(500, "server_error", "Internal Server Error"),
  oauthFault(503, "temporarily_unavailable", "Service Unavailable"),
  { kind: "delay", ms: 10_000 },
  { kind: "reset" },
  { kind: "reset-after" },
  /* A grant Auth0 refuses: a refresh token revoked or rotated out elsewhere, or a spent code. */
  oauthFault(403, "invalid_grant", "Unknown or invalid refresh token."),
] as const

const KEY_FAULTS = [
  {
    kind: "status",
    status: 500,
    headers: { "content-type": "text/plain" },
    body: "Internal Server Error",
  },
  {
    kind: "status",
    status: 503,
    headers: { "content-type": "text/plain" },
    body: "Service Unavailable",
  },
  { kind: "reset" },
] as const

const USERINFO_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { "content-type": "text/plain", "retry-after": "1" },
    body: "Too Many Requests",
  },
  {
    kind: "status",
    status: 500,
    headers: { "content-type": "text/plain" },
    body: "Internal Server Error",
  },
  { kind: "reset" },
] as const

const MANAGEMENT_WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"])

function managementFaults(method: string) {
  const reset = String(Math.ceil(Date.now() / 1000) + 1)

  return [
    managementFault(429, "Global limit has been reached", {
      "x-ratelimit-limit": "50",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": reset,
    }),
    managementFault(500, "Internal Server Error"),
    managementFault(503, "Service Unavailable"),
    { kind: "delay", ms: 10_000 } as const,
    { kind: "reset" } as const,
    ...(MANAGEMENT_WRITES.has(method) ? [{ kind: "reset-after" } as const] : []),
  ]
}

/**
 * Failures an Auth0 tenant can hand an app's server calls, as the fault matrix injects them at
 * the proxy. The token endpoint: 429, 500, 503, delay, resets, and an `invalid_grant`. The signing keys: 5xx and reset, so an app can show it fails closed when JWKS
 * is down. `/userinfo`: 429, 500, reset. The Management API: its 429 with `x-ratelimit-reset`,
 * 5xx, delay and reset, plus a reset after a write. The browser's login pages are left alone.
 */
export function auth0OutboundFaults(call: { method: string; path: string }) {
  const path = call.path.split("?")[0] ?? ""

  if (call.method === "POST" && path === "/oauth/token") return TOKEN_FAULTS
  if (path === "/.well-known/jwks.json") return KEY_FAULTS
  if (path === "/userinfo") return USERINFO_FAULTS
  if (path.startsWith("/api/v2/")) return managementFaults(call.method)

  return []
}
