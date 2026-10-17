const json = { "content-type": "application/json; charset=utf-8" }
const error = (code: string, description: string) =>
  JSON.stringify({ error: code, error_description: description })

/**
 * Failures Google sign-in can meet, as the fault matrix injects them at the proxy. Only the
 * app's server-to-server calls are faulted: the token exchange and refresh (`POST /token`),
 * revocation, userinfo and the signing keys. The browser's own requests (the account chooser on
 * accounts.google.com and its redirect back) are left alone. Status faults carry Google's
 * `{ error, error_description }` body; the 5xx wording is an approximation. An `invalid_grant` on
 * the token call is what an app sees for a code already used or a refresh token revoked by the
 * user; a reset after Google acted leaves the code spent, so a retry gets `invalid_grant` too.
 */
export function googleOutboundFaults(call: { method: string; path: string }) {
  if (call.method === "POST" && call.path === "/token")
    return [
      {
        kind: "status",
        status: 500,
        headers: json,
        body: error("internal_failure", "Backend Error"),
      },
      {
        kind: "status",
        status: 503,
        headers: json,
        body: error("temporarily_unavailable", "Service unavailable"),
      },
      {
        kind: "status",
        status: 400,
        headers: json,
        body: error("invalid_grant", "Token has been expired or revoked."),
      },
      { kind: "delay", ms: 10_000 },
      { kind: "reset" },
      { kind: "reset-after" },
    ] as const
  if (
    call.method === "GET" &&
    /^\/(v1|oauth2\/v[23])\/userinfo$|^\/oauth2\/v[13]\/certs$/.test(call.path)
  )
    return [
      {
        kind: "status",
        status: 500,
        headers: json,
        body: error("internal_failure", "Backend Error"),
      },
      { kind: "reset" },
    ] as const

  return []
}
