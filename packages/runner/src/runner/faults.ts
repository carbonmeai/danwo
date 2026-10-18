import {
  FLUTTERWAVE_HOSTS,
  flutterwaveOutboundFaults,
  BACHS_HOSTS,
  bachsOutboundFaults,
  GITHUB_HOSTS,
  githubOutboundFaults,
  GOOGLE_HOSTS,
  googleOutboundFaults,
  isS3Host,
  LLM_HOSTS,
  llmOutboundFaults,
  MICROSOFT_HOSTS,
  microsoftOutboundFaults,
  PAYSTACK_HOSTS,
  paystackOutboundFaults,
  resendOutboundFaults,
  s3OutboundFaults,
  SLACK_HOSTS,
  slackOutboundFaults,
  stripeOutboundFaults,
  TWILIO_HOSTS,
  twilioOutboundFaults,
  type WebhookFault,
} from "@danwo/emulators"
import type { OutboundCall, OutboundFault } from "@danwo/proxy"

type Catalogue = (call: OutboundCall) => readonly OutboundFault[]

/** Each provider's own fault catalogue, by the hosts it answers. */
const BY_HOST = new Map<string, Catalogue>([
  ...hostsOf(["api.stripe.com", "checkout.stripe.com"], stripeOutboundFaults),
  ...hostsOf(["api.resend.com"], resendOutboundFaults),
  ...hostsOf(GOOGLE_HOSTS, googleOutboundFaults),
  ...hostsOf(MICROSOFT_HOSTS, microsoftOutboundFaults),
  ...hostsOf(SLACK_HOSTS, slackOutboundFaults),
  ...hostsOf(GITHUB_HOSTS, githubOutboundFaults),
  ...hostsOf(TWILIO_HOSTS, twilioOutboundFaults),
  ...hostsOf(FLUTTERWAVE_HOSTS, flutterwaveOutboundFaults),
  ...hostsOf(PAYSTACK_HOSTS, paystackOutboundFaults),
  ...hostsOf(BACHS_HOSTS, bachsOutboundFaults),
  ...hostsOf(LLM_HOSTS, llmOutboundFaults),
])

/** Pairs every host with the catalogue that serves it. */
function hostsOf(hosts: readonly string[], catalogue: Catalogue): Array<[string, Catalogue]> {
  return hosts.map((host) => [host, catalogue])
}

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
 * Resend, S3 and Tigris, Google, Microsoft, Slack, GitHub, Twilio, Flutterwave, Paystack, Bachs and
 * the model APIs, with error bodies their SDKs parse),
 * and any other routed host (an outside endpoint such as MiniStack) gets plain HTTP failures.
 */
export function defaultOutboundFaults(call: OutboundCall): readonly OutboundFault[] {
  const catalogue = BY_HOST.get(call.host) ?? (isS3Host(call.host) ? s3OutboundFaults : undefined)

  return catalogue ? catalogue(call) : genericOutboundFaults(call)
}

/** Webhook faults when the config names none: a repeat, a late one, a forgery, an old one. */
export const DEFAULT_WEBHOOK_FAULTS: readonly WebhookFault[] = [
  { kind: "duplicate" },
  { kind: "delay", ms: 10 * 60_000 },
  { kind: "forged" },
  { kind: "stale", seconds: 3600 },
]
