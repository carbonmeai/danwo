const SENDS = new Set(["/emails", "/emails/batch"])

const error = (statusCode: number, name: string, message: string) =>
  JSON.stringify({ statusCode, message, name })

/**
 * Failures a Resend send can meet, as the fault matrix injects them at the proxy: the calls that
 * send mail (`POST /emails`, `POST /emails/batch`), since a lost sign-in code is what an app has
 * to survive. Status faults carry Resend's error body (`{ statusCode, message, name }`) so the SDK
 * returns the error an app would see; the 429 also carries Resend's rate limit headers. The
 * messages are approximations. A delay checks the app's own timeout (the SDK sets none), and a
 * reset after Resend acted checks that a retry does not send the code twice.
 */
export function resendOutboundFaults(call: { method: string; path: string }) {
  if (call.method !== "POST" || !SENDS.has(call.path)) return []

  return [
    {
      kind: "status",
      status: 429,
      headers: {
        "ratelimit-limit": "2",
        "ratelimit-remaining": "0",
        "ratelimit-reset": "1",
        "retry-after": "1",
      },
      body: error(
        429,
        "rate_limit_exceeded",
        "Too many requests. You can only make 2 requests per second. See rate limit response headers for more information. Or contact support to increase rate limit.",
      ),
    },
    {
      kind: "status",
      status: 500,
      body: error(500, "application_error", "An unexpected error occurred."),
    },
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
  ] as const
}
