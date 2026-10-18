import { errorBody } from "./helpers.ts"

const json = { "content-type": "application/json" }

/** A status fault whose body is Twilio's error, as the SDK parses it into a `RestException`. */
function status(
  code: number,
  httpStatus: number,
  message: string,
  extra: Record<string, string> = {},
) {
  return {
    kind: "status",
    status: httpStatus,
    headers: { ...json, ...extra },
    body: JSON.stringify(errorBody(httpStatus, code, message)),
  } as const
}

const TOO_MANY = status(20429, 429, "Too Many Requests", { "retry-after": "1" })
const BROKEN = status(20500, 500, "Internal Server Error")
const DOWN = status(20503, 503, "Service Unavailable")

/** Whether a call sends a message or starts or checks a verification: it changes something. */
function isWrite(call: { method: string }): boolean {
  return call.method === "POST" || call.method === "DELETE"
}

/**
 * Failures a Twilio call can meet, as the fault matrix injects them at the proxy: rate limiting
 * (20429), Twilio failing (20500) or being unavailable, which on Verify checks is an outage of the
 * sign-in step itself (20503), a slow answer, and a dropped connection. Calls that change something
 * also get a connection dropped after Twilio acted, so an app that retries a send or a
 * verification shows whether it texts the person twice.
 */
export function twilioOutboundFaults(call: { method: string; path: string }) {
  const reads = [TOO_MANY, BROKEN, { kind: "reset" }] as const

  if (!isWrite(call)) return reads

  return [
    TOO_MANY,
    BROKEN,
    DOWN,
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
  ] as const
}
