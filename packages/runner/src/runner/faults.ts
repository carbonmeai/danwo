import {
  auth0OutboundFaults,
  clerkOutboundFaults,
  COMPOSIO_HOSTS,
  composioOutboundFaults,
  isClerkHost,
  FLUTTERWAVE_HOSTS,
  flutterwaveOutboundFaults,
  BACHS_HOSTS,
  bachsOutboundFaults,
  GITHUB_HOSTS,
  githubOutboundFaults,
  GOOGLE_HOSTS,
  googleOutboundFaults,
  isAuth0Host,
  isS3Host,
  LLM_HOSTS,
  NANGO_HOSTS,
  nangoOutboundFaults,
  NYLAS_HOSTS,
  nylasOutboundFaults,
  unipileOutboundFaults,
  llmOutboundFaults,
  MICROSOFT_HOSTS,
  microsoftOutboundFaults,
  NOVU_HOSTS,
  novuOutboundFaults,
  pusherOutboundFaults,
  tiptapOutboundFaults,
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

import { INNGEST_HOST, inngestOutboundFaults } from "./inngest.ts"

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
  ...hostsOf(COMPOSIO_HOSTS, composioOutboundFaults),
  ...hostsOf(NYLAS_HOSTS, nylasOutboundFaults),
  ...hostsOf(NANGO_HOSTS, nangoOutboundFaults),
  ...hostsOf(NOVU_HOSTS, novuOutboundFaults),
  ...hostsOf([INNGEST_HOST], inngestOutboundFaults),
])

/** Pairs every host with the catalogue that serves it. */
function hostsOf(hosts: readonly string[], catalogue: Catalogue): Array<[string, Catalogue]> {
  return hosts.map((host) => [host, catalogue])
}

/**
 * The catalogue for providers known by a host pattern rather than a list: S3 buckets, Auth0
 * tenants, Clerk instances, Unipile DSNs, Pusher clusters and Beams instances, and Tiptap
 * collaboration apps.
 */
function catalogueByPattern(host: string): Catalogue | undefined {
  if (isS3Host(host)) return s3OutboundFaults
  if (isAuth0Host(host)) return auth0OutboundFaults
  if (isClerkHost(host)) return clerkOutboundFaults
  if (host === "unipile.com" || host.endsWith(".unipile.com")) return unipileOutboundFaults
  if (host.endsWith(".pusher.com") || host.endsWith(".pusherapp.com")) return pusherOutboundFaults
  if (host.endsWith(".collab.tiptap.cloud")) return tiptapOutboundFaults

  return undefined
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
 * Resend, S3 and Tigris, Auth0, Google, Microsoft, Slack, GitHub, Twilio, Flutterwave, Paystack, Bachs,
 * Clerk, Composio, Nylas, Nango, Unipile, Pusher, Novu, Tiptap and the model APIs, with error
 * bodies their SDKs parse),
 * and any other routed host (an outside endpoint such as MiniStack) gets plain HTTP failures.
 */
export function defaultOutboundFaults(call: OutboundCall): readonly OutboundFault[] {
  const catalogue = BY_HOST.get(call.host) ?? catalogueByPattern(call.host)

  return catalogue ? catalogue(call) : genericOutboundFaults(call)
}

/** Webhook faults when the config names none: a repeat, a late one, a forgery, an old one. */
export const DEFAULT_WEBHOOK_FAULTS: readonly WebhookFault[] = [
  { kind: "duplicate" },
  { kind: "delay", ms: 10 * 60_000 },
  { kind: "forged" },
  { kind: "stale", seconds: 3600 },
]

/** Data faults when the config names none: by the protocol each data proxy speaks. */
export { defaultDataFaults } from "@danwo/infra"
