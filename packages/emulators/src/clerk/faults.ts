import { clerkErrorBody } from "./helpers.ts"

const json = { "content-type": "application/json" }

/** A status fault with Clerk's error body (and any extra headers). */
function fault(
  status: number,
  code: string,
  message: string,
  longMessage: string,
  headers: Record<string, string> = {},
) {
  return {
    kind: "status",
    status,
    headers: { ...json, ...headers },
    body: JSON.stringify(clerkErrorBody([{ message, long_message: longMessage, code }])),
  } as const
}

const RATE_LIMITED = fault(
  429,
  "too_many_requests",
  "Too many requests",
  "Too many requests, retry later",
  { "retry-after": "10" },
)
const INTERNAL = fault(
  500,
  "internal_clerk_error",
  "Oops, an unexpected error occurred",
  "There was an internal error on our servers. We've been notified and are working on fixing it.",
)
const UNAVAILABLE = fault(
  503,
  "service_unavailable",
  "Service unavailable",
  "The service is temporarily unavailable, please retry later.",
)

/** Frontend API paths: the browser's, not the app server's, so the matrix leaves most alone. */
const FRONTEND = /^\/v1\/(client(\/|$)|environment$|dev_browser$)/

/** ClerkJS refreshing the session token, about every 50 seconds while a page is open. */
const TOKEN_REFRESH = /^\/v1\/client\/sessions\/[^/]+\/tokens(\/[^/]+)?$/

const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"])

/** The faults every Backend API call can meet, plus a reset after Clerk acted for writes. */
function backendFaults(method: string) {
  return [
    RATE_LIMITED,
    INTERNAL,
    UNAVAILABLE,
    { kind: "delay", ms: 10_000 } as const,
    { kind: "reset" } as const,
    ...(WRITES.has(method) ? [{ kind: "reset-after" } as const] : []),
  ]
}

/**
 * Failures Clerk can hand an app's server, as the fault matrix injects them at the proxy. Every
 * Backend API call: a 429 with `Retry-After`, a 500 and a 503 in Clerk's error format, a 10 s
 * delay and a reset, with a reset after Clerk acted for writes. Collecting a handshake's cookies
 * and loading the signing keys meet 500 and reset only, the failures a server's sign-in check
 * must survive. Of the Frontend API, only ClerkJS's token refresh fails (500 and 503), so a
 * page must cope with a token it cannot renew; the rest of the browser's calls and pages are left
 * alone. The 5xx wording is approximate.
 */
export function clerkOutboundFaults(call: { method: string; path: string }) {
  const path = call.path.split("?")[0] ?? ""

  if (TOKEN_REFRESH.test(path)) return [INTERNAL, UNAVAILABLE]
  if (!path.startsWith("/v1/") || FRONTEND.test(path)) return []
  if (path === "/v1/jwks" || path === "/v1/clients/handshake_payload")
    return [INTERNAL, { kind: "reset" } as const]

  return backendFaults(call.method)
}
