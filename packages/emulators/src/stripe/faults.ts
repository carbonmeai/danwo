/** What the Stripe emulator can be asked to do in place of a normal answer: decline the card. */
export const STRIPE_BEHAVIOURS = ["card_declined"] as const

/** The hosted Checkout page's Pay button, as the browser posts it. */
const HOSTED_PAY = /^\/checkout\/[^/?]+\/complete(\?|$)/

/**
 * Failures a Stripe API call can meet, as the fault matrix injects them at the proxy. Status
 * faults carry Stripe's error body so the SDK raises the error type an app would see. Paying on
 * the hosted Checkout page can also meet a declined card, whatever card the test typed.
 *
 * The bodies follow Stripe's documented error shape (`{ error: { type, code?, message } }`);
 * the exact messages are approximations.
 */
export function stripeOutboundFaults(call: {
  readonly method: string
  readonly host?: string
  readonly path?: string
}) {
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
  if (call.method === "GET") return faults

  const writes = [...faults, { kind: "reset-after" }] as const

  return call.host === "checkout.stripe.com" && HOSTED_PAY.test(call.path ?? "")
    ? ([...writes, { kind: "emulate", behaviour: STRIPE_BEHAVIOURS[0] }] as const)
    : writes
}
