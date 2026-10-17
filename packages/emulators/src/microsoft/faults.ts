const json = { "content-type": "application/json; charset=utf-8" }

const aad = (error: string, code: number, message: string) =>
  JSON.stringify({ error, error_description: `AADSTS${code}: ${message}`, error_codes: [code] })

const graph = (code: string, message: string) => JSON.stringify({ error: { code, message } })

const TOKEN = /^\/[^/]+\/oauth2\/v2\.0\/token$/

/**
 * Failures Microsoft sign-in can meet, as the fault matrix injects them at the proxy. Only the
 * app's server-to-server calls are faulted: the token exchange and refresh, Graph `/me` and
 * `/oidc/userinfo`, and the signing keys. The browser's own requests (the account picker on
 * login.microsoftonline.com and its redirect back) are left alone. Bodies follow Microsoft's
 * `AADSTS` and Graph error shapes; the wording is an approximation. MSAL retries a 5xx token call
 * once; an `invalid_grant` (AADSTS70008) is what an app sees for an expired code or refresh token;
 * a reset after Microsoft acted leaves the code spent, so a retry gets AADSTS54005.
 */
export function microsoftOutboundFaults(call: { method: string; path: string }) {
  if (call.method === "POST" && TOKEN.test(call.path))
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
  if (call.method === "GET" && (call.path === "/v1.0/me" || call.path === "/oidc/userinfo"))
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
  if (call.method === "GET" && call.path.endsWith("/discovery/v2.0/keys"))
    return [
      {
        kind: "status",
        status: 500,
        headers: json,
        body: aad("server_error", 50000, "Service error."),
      },
      { kind: "reset" },
    ] as const

  return []
}
