const json = { "content-type": "application/json; charset=utf-8" }

const aad = (error: string, code: number, message: string) =>
  JSON.stringify({ error, error_description: `AADSTS${code}: ${message}`, error_codes: [code] })

const graph = (code: string, message: string) => JSON.stringify({ error: { code, message } })

const TOKEN = /^\/[^/]+\/oauth2\/v2\.0\/token$/
const USER = String.raw`^/v1\.0/(?:me|users/[^/]+)`
const OUTLOOK = new RegExp(
  `${USER}/(?:messages|mailFolders|sendMail|events|calendars?|calendarView)(?:/|$)`,
)
const DRIVE = new RegExp(`(?:${USER}/drive|^/v1\\.0/drives/[^/]+)(?:/|$)|^/up/`)
const SUBSCRIPTIONS = /^\/v1\.0\/subscriptions(?:\/|$)/

type Call = { method: string; path: string }

/** What a throttled, unavailable or timed-out Graph call answers. */
function serviceFaults() {
  return [
    {
      kind: "status",
      status: 429,
      headers: { ...json, "retry-after": "2" },
      body: graph(
        "TooManyRequests",
        "Too many requests. Please retry after the time in Retry-After.",
      ),
    },
    {
      kind: "status",
      status: 503,
      headers: { ...json, "retry-after": "2" },
      body: graph("serviceNotAvailable", "The service is temporarily unavailable."),
    },
    {
      kind: "status",
      status: 504,
      headers: json,
      body: graph("gatewayTimeout", "The gateway did not receive a timely response."),
    },
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
  ] as const
}

/** A delta link the service no longer honours: the app must start its sync again. */
function expiredDelta(call: Call) {
  const body = DRIVE.test(call.path)
    ? graph("resyncRequired", "Resync required. Replace any local items with the server's version.")
    : graph("SyncStateNotFound", "The sync state generation is no longer valid. Please resync.")

  return { kind: "status", status: 410, headers: json, body } as const
}

const LOCKED = {
  kind: "status",
  status: 423,
  headers: json,
  body: graph("resourceLocked", "The resource you are attempting to access is locked."),
} as const

/** Faults for a mail, calendar, drive or subscription call: shared ones, plus per-API extras. */
function graphApiFaults(call: Call) {
  const writes = call.method !== "GET"
  const extras = [
    ...(call.path.endsWith("/delta") ? [expiredDelta(call)] : []),
    ...(writes && DRIVE.test(call.path) ? [LOCKED] : []),
    ...(writes ? [{ kind: "reset-after" } as const] : []),
  ]

  return [...serviceFaults(), ...extras]
}

function signInFaults() {
  return [
    {
      kind: "status",
      status: 500,
      headers: json,
      body: aad("server_error", 50000, "There was an error issuing a token."),
    },
    {
      kind: "status",
      status: 503,
      headers: json,
      body: aad(
        "temporarily_unavailable",
        90006,
        "The server is temporarily too busy to handle the request.",
      ),
    },
    {
      kind: "status",
      status: 400,
      headers: json,
      body: aad(
        "invalid_grant",
        70008,
        "The provided authorization code or refresh token has expired due to inactivity.",
      ),
    },
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
  ] as const
}

function profileFaults() {
  return [
    {
      kind: "status",
      status: 429,
      headers: { ...json, "retry-after": "1" },
      body: graph("TooManyRequests", "Too many requests."),
    },
    {
      kind: "status",
      status: 503,
      headers: json,
      body: graph("serviceNotAvailable", "Service unavailable."),
    },
    { kind: "reset" },
  ] as const
}

function keyFaults() {
  return [
    {
      kind: "status",
      status: 500,
      headers: json,
      body: aad("server_error", 50000, "Service error."),
    },
    { kind: "reset" },
  ] as const
}

const isGraphApi = (call: Call) =>
  OUTLOOK.test(call.path) || DRIVE.test(call.path) || SUBSCRIPTIONS.test(call.path)

/**
 * Failures Microsoft sign-in and Graph can meet, as the fault matrix injects them at the proxy.
 * Only the app's server-to-server calls are faulted, not the browser's account picker.
 *
 * - Sign-in: the token exchange and refresh (`AADSTS` bodies; an `invalid_grant` is what an app
 *   sees for an expired code or refresh token), `/me` and `/oidc/userinfo`, and the signing keys.
 * - Mail, calendar, drive and subscription calls: throttling (429 with `Retry-After`), 503 and
 *   504, a slow answer and a dropped connection; writes also a drop after Graph acted; drive
 *   writes a 423 locked item; delta calls a 410 expired sync state, which forces a full resync.
 *
 * Bodies follow Graph's error shape; the wording is an approximation.
 */
export function microsoftOutboundFaults(call: Call) {
  if (call.method === "POST" && TOKEN.test(call.path)) return signInFaults()
  if (call.method === "GET" && (call.path === "/v1.0/me" || call.path === "/oidc/userinfo"))
    return profileFaults()
  if (call.method === "GET" && call.path.endsWith("/discovery/v2.0/keys")) return keyFaults()
  if (isGraphApi(call)) return graphApiFaults(call)

  return []
}
