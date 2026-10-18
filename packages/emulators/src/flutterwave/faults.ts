const json = { "content-type": "application/json" }

/** A status fault whose body is Flutterwave's error envelope. */
function refusal(httpStatus: number, message: string, extra: Record<string, string> = {}) {
  return {
    kind: "status",
    status: httpStatus,
    headers: { ...json, ...extra },
    body: JSON.stringify({ status: "error", message, data: null }),
  } as const
}

const TOO_MANY = refusal(429, "Too many requests. Please try again later.", { "retry-after": "1" })
const UNAVAILABLE = refusal(503, "Service temporarily unavailable. Please try again later.")

/** Flutterwave's answer to an error on its side: its own shape, not the envelope. */
const BROKEN = {
  kind: "status",
  status: 500,
  headers: json,
  body: JSON.stringify({
    error_id: "ERRNO000000000T0000000000000",
    message: "Application error. Please contact support",
    code: "app_error",
  }),
} as const

/**
 * A verification that answers before the payment has settled: the transaction is still pending, so
 * an app that gives value without a `successful` status shows it here.
 */
const STILL_PENDING = {
  kind: "status",
  status: 200,
  headers: json,
  body: JSON.stringify({
    status: "success",
    message: "Transaction fetched successfully",
    data: {
      status: "pending",
      processor_response: "Transaction is pending",
      amount: 0,
      currency: "NGN",
    },
  }),
} as const

/** Whether a call starts a payment, a transfer or a refund, or changes something else. */
function isWrite(call: { method: string }): boolean {
  return call.method !== "GET"
}

/** Whether a call verifies a transaction, by id or by reference. */
function isVerify(call: { path: string }): boolean {
  return /\/v3\/transactions\/(?:[^/]+\/verify|verify_by_reference)/.test(call.path)
}

/**
 * Failures a Flutterwave call can meet, as the fault matrix injects them at the proxy: rate limiting,
 * Flutterwave failing or being unavailable, a slow answer and a dropped connection. Writes also lose
 * the connection after Flutterwave acted, so an app that retries a payment link or a transfer shows
 * whether it charges or pays twice. A verification can also come back still pending. The hosted
 * payment page, which the customer's browser loads, can only fail or drop the connection.
 */
export function flutterwaveOutboundFaults(call: { method: string; path: string }) {
  if (call.path.startsWith("/v3/hosted/")) return [BROKEN, { kind: "reset" }] as const
  if (isVerify(call)) return [TOO_MANY, BROKEN, STILL_PENDING, { kind: "reset" }] as const
  if (!isWrite(call)) return [TOO_MANY, BROKEN, { kind: "reset" }] as const

  return [
    TOO_MANY,
    BROKEN,
    UNAVAILABLE,
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    { kind: "reset-after" },
  ] as const
}
