import {
  GITHUB_HOSTS,
  githubOutboundFaults,
  GOOGLE_HOSTS,
  googleOutboundFaults,
  isS3Host,
  MICROSOFT_HOSTS,
  microsoftOutboundFaults,
  resendOutboundFaults,
  s3OutboundFaults,
  SLACK_HOSTS,
  slackOutboundFaults,
  stripeOutboundFaults,
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
 * Resend, S3 and Tigris, Google, Microsoft, Slack and GitHub, with error bodies their SDKs parse),
 * and any other routed host (an outside endpoint such as MiniStack) gets plain HTTP failures.
 */
export function defaultOutboundFaults(call: OutboundCall): readonly OutboundFault[] {
  const catalogue = BY_HOST.get(call.host) ?? (isS3Host(call.host) ? s3OutboundFaults : undefined)

  return catalogue ? catalogue(call) : genericOutboundFaults(call)
}
