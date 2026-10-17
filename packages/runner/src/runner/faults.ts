import {
  GOOGLE_HOSTS,
  googleOutboundFaults,
  isS3Host,
  MICROSOFT_HOSTS,
  microsoftOutboundFaults,
  resendOutboundFaults,
  s3OutboundFaults,
  stripeOutboundFaults,
} from "@danwo/emulators"
import type { OutboundCall, OutboundFault } from "@danwo/proxy"

const STRIPE_HOSTS = new Set(["api.stripe.com", "checkout.stripe.com"])
const GOOGLE = new Set<string>(GOOGLE_HOSTS)
const MICROSOFT = new Set<string>(MICROSOFT_HOSTS)

/** Failures any HTTP API can meet, for hosts danwo has no provider-shaped catalogue for. */
function genericOutboundFaults(call: OutboundCall): readonly OutboundFault[] {
  const faults: readonly OutboundFault[] = [
    { kind: "status", status: 500, body: "Internal Server Error" },
    { kind: "reset" },
  ]

  // A dropped response after the server acted only matters for calls that change something.
  return call.method === "GET" || call.method === "HEAD"
    ? faults
    : [...faults, { kind: "reset-after" }]
}

/**
 * `danwo matrix`'s default fault catalogue: each call gets its provider's faults by host (Stripe,
 * Resend, S3 and Tigris, Google and Microsoft sign-in, with error bodies their SDKs parse), and any other routed host (an
 * outside endpoint such as MiniStack) gets plain HTTP failures.
 */
export function defaultOutboundFaults(call: OutboundCall): readonly OutboundFault[] {
  if (STRIPE_HOSTS.has(call.host)) return stripeOutboundFaults(call)
  if (call.host === "api.resend.com") return resendOutboundFaults(call)
  if (isS3Host(call.host)) return s3OutboundFaults(call)
  if (GOOGLE.has(call.host)) return googleOutboundFaults(call)
  if (MICROSOFT.has(call.host)) return microsoftOutboundFaults(call)

  return genericOutboundFaults(call)
}
