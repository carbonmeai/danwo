import { githubErrorBody } from "./helpers.ts"

const json = { "content-type": "application/json; charset=utf-8" }

/** A status fault with GitHub's error body (and any extra headers). */
function fault(status: number, message: string, headers: Record<string, string> = {}) {
  return {
    kind: "status",
    status,
    headers: { ...json, ...headers },
    body: JSON.stringify(githubErrorBody(status, message)),
  } as const
}

const SECONDARY =
  "You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID."

/** The token exchange answers its errors with HTTP 200 and an `error` field. */
const TOKEN_FAULTS = [
  {
    kind: "status",
    status: 200,
    headers: json,
    body: JSON.stringify({
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
      error_uri:
        "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code",
    }),
  },
  fault(502, "Server Error"),
  { kind: "delay", ms: 10_000 },
  { kind: "reset" },
  { kind: "reset-after" },
] as const

const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"])

/** Writes that can lose a race: a stale `sha` on contents, a moved head on merge. */
const CONFLICTS = /\/contents\/|\/pulls\/\d+\/merge$/

/** The faults any REST call can meet, plus what writes add. */
function restFaults(method: string, path: string) {
  const write = WRITES.has(method)

  return [
    fault(403, SECONDARY, { "retry-after": "60" }),
    fault(429, SECONDARY, { "retry-after": "60" }),
    fault(502, "Server Error"),
    fault(503, "Service Unavailable"),
    { kind: "delay", ms: 10_000 } as const,
    { kind: "reset" } as const,
    ...(write ? [{ kind: "reset-after" } as const] : []),
    ...(write && method !== "DELETE" ? [fault(422, "Validation Failed")] : []),
    ...(write && CONFLICTS.test(path) ? [fault(409, "Conflict")] : []),
  ]
}

/**
 * Failures GitHub can hand an app's server-to-server calls, as the fault matrix injects them at
 * the proxy. The token exchange: GitHub's `bad_verification_code` (which it answers with HTTP
 * 200), a 502, delay and resets. Every REST call: the secondary rate limit as a 403 or 429 with
 * `Retry-After`, 502 and 503, delay and reset; writes add a reset after GitHub acted, a 422, and
 * a 409 for contents and merges. The browser's sign-in page is left alone. Error bodies are
 * GitHub's shape; the 5xx wording is approximate.
 */
export function githubOutboundFaults(call: { method: string; path: string }) {
  const path = call.path.split("?")[0] ?? ""

  if (call.method === "POST" && path === "/login/oauth/access_token") return TOKEN_FAULTS
  if (path.startsWith("/login/")) return []

  return restFaults(call.method, path)
}
