import { apiErrorBody } from "./api.ts"

const json = { "content-type": "application/json; charset=utf-8" }
const oauthError = (code: string, description: string) =>
  JSON.stringify({ error: code, error_description: description })

/** A status fault carrying Google's API error body (and any extra headers). */
function apiFault(
  status: number,
  reason: string,
  message: string,
  headers: Record<string, string> = {},
) {
  return {
    kind: "status",
    status,
    headers: { ...json, ...headers },
    body: JSON.stringify(apiErrorBody(status, reason, message)),
  } as const
}

/** Sign-in faults: the token exchange and refresh. */
const TOKEN_FAULTS = [
  {
    kind: "status",
    status: 500,
    headers: json,
    body: oauthError("internal_failure", "Backend Error"),
  },
  {
    kind: "status",
    status: 503,
    headers: json,
    body: oauthError("temporarily_unavailable", "Service unavailable"),
  },
  {
    kind: "status",
    status: 400,
    headers: json,
    body: oauthError("invalid_grant", "Token has been expired or revoked."),
  },
  { kind: "delay", ms: 10_000 },
  { kind: "reset" },
  { kind: "reset-after" },
] as const

/** Sign-in faults on userinfo and the signing keys. */
const LOOKUP_FAULTS = [
  {
    kind: "status",
    status: 500,
    headers: json,
    body: oauthError("internal_failure", "Backend Error"),
  },
  { kind: "reset" },
] as const

/** How each API answers when the caller goes over its quota. */
const QUOTA: Readonly<Record<string, readonly [string, string]>> = {
  gmail: ["userRateLimitExceeded", "User-rate limit exceeded."],
  calendar: ["rateLimitExceeded", "Rate Limit Exceeded"],
  drive: ["userRateLimitExceeded", "User rate limit exceeded."],
}

/** The API a path belongs to, uploads included. */
function apiOf(path: string): string | undefined {
  return /^\/(?:upload\/)?(gmail|calendar|drive)\//.exec(path)?.[1]
}

/** Faults one particular call has on top of the common ones: expired history and sync tokens. */
function specialFaults(method: string, path: string) {
  if (method === "GET" && /^\/gmail\/v1\/users\/[^/]+\/history$/.test(path))
    return [apiFault(404, "notFound", "Requested entity was not found.")]
  if (method === "GET" && /^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(path))
    return [
      apiFault(410, "fullSyncRequired", "Sync token is no longer valid, a full sync is required."),
    ]

  return []
}

/** The faults every Gmail, Calendar or Drive call can meet. */
function apiFaults(api: string, method: string, path: string) {
  const [reason, message] = QUOTA[api] ?? ["rateLimitExceeded", "Rate Limit Exceeded"]

  return [
    apiFault(429, reason, message, { "retry-after": "1" }),
    apiFault(403, reason, message),
    apiFault(500, "backendError", "Backend Error"),
    apiFault(503, "backendError", "Backend Error"),
    { kind: "delay", ms: 10_000 } as const,
    { kind: "reset" } as const,
    ...(method === "GET" ? [] : [{ kind: "reset-after" } as const]),
    ...specialFaults(method, path),
  ]
}

/**
 * Failures Google can hand the app's server-to-server calls, as the fault matrix injects them at
 * the proxy. Sign-in: the token exchange and refresh (5xx, `invalid_grant`, delay, resets) and
 * userinfo and the signing keys. Gmail, Calendar and Drive: rate limits (429 with `Retry-After`,
 * and the 403 quota answer), backend errors, delay and resets, plus Gmail's 404 for history that
 * is no longer kept and Calendar's 410 for an expired sync token. The browser's own requests (the
 * account chooser and its redirect) are left alone. Error bodies are Google's shapes; the wording
 * of 5xx and quota messages is approximate.
 */
export function googleOutboundFaults(call: { method: string; path: string }) {
  const path = call.path.split("?")[0] ?? ""

  if (call.method === "POST" && path === "/token") return TOKEN_FAULTS
  if (
    call.method === "GET" &&
    /^\/(v1|oauth2\/v[23])\/userinfo$|^\/oauth2\/v[13]\/certs$/.test(path)
  )
    return LOOKUP_FAULTS

  const api = apiOf(path)

  return api ? apiFaults(api, call.method, path) : []
}
