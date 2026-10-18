const json = { "content-type": "application/json" }

/** A status fault whose body is Paystack's envelope, as an app reads it. */
function status(code: number, message: string, extra: Record<string, string> = {}) {
  return {
    kind: "status",
    status: code,
    headers: { ...json, ...extra },
    body: JSON.stringify({ status: false, message }),
  } as const
}

const TOO_MANY = status(429, "Too many requests. Please try again later.", { "retry-after": "2" })
const BROKEN = status(500, "An error occurred")
const DOWN = status(503, "Service temporarily unavailable")

/**
 * A verify call that answers 200 but says the payment is not settled yet, as Paystack does while
 * a transfer or USSD payment is still being confirmed: an app that grants value on anything but
 * `success` shows it here.
 */
const STILL_PENDING = {
  kind: "status",
  status: 200,
  headers: json,
  body: JSON.stringify({
    status: true,
    message: "Verification successful",
    data: { status: "pending", gateway_response: "Transaction is being processed", amount: 0 },
  }),
} as const

/** Whether a call changes something: initializing, charging, transferring, refunding. */
function isWrite(call: { method: string }): boolean {
  return call.method !== "GET" && call.method !== "HEAD"
}

/** Whether a call is the hosted page the customer's browser loads, which the matrix leaves alone. */
function isPage(call: { host?: string; path: string }): boolean {
  return call.host === "checkout.paystack.com"
}

/**
 * Failures a Paystack call can meet, as the fault matrix injects them at the proxy: rate limiting,
 * Paystack failing or unavailable, a slow answer, and a dropped connection. Calls that change
 * something also get a connection dropped after Paystack acted, so an app that retries an
 * initialize, charge or transfer shows whether it does it twice. Verifying a transaction can also
 * come back still pending.
 */
export function paystackOutboundFaults(call: { method: string; path: string; host?: string }) {
  if (isPage(call)) return []

  if (!isWrite(call)) {
    const reads = [TOO_MANY, BROKEN, { kind: "reset" }] as const

    return call.path.startsWith("/transaction/verify/") ? [...reads, STILL_PENDING] : reads
  }

  return [
    TOO_MANY,
    BROKEN,
    DOWN,
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
  ] as const
}
