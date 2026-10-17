/**
 * Failures a Stripe API call can meet, as the fault matrix injects them at the proxy. Status
 * faults carry Stripe's error body so the SDK raises the error type an app would see.
 *
 * The bodies follow Stripe's documented error shape (`{ error: { type, code?, message } }`);
 * the exact messages are approximations.
 */
export function stripeOutboundFaults(call: { method: string }) {
  const faults = [
    {
      kind: "status",
      status: 500,
      body: JSON.stringify({ error: { type: "api_error", message: "An unknown error occurred." } }),
    },
    {
      kind: "status",
      status: 429,
      body: JSON.stringify({
        error: {
          type: "invalid_request_error",
          code: "rate_limit",
          message:
            "Request rate limit exceeded. Learn more about rate limits here https://stripe.com/docs/rate-limits.",
        },
      }),
    },
    { kind: "reset" },
  ] as const

  // A dropped response after Stripe acted only matters for calls that change something.
  return call.method === "GET" ? faults : ([...faults, { kind: "reset-after" }] as const)
}
