const json = { "content-type": "application/json" }

const problem = (status: number, type: string, title: string, detail: string) =>
  JSON.stringify({ status, type, title, detail })

const COMMON = [
  {
    kind: "status",
    status: 500,
    headers: json,
    body: problem(
      500,
      "errors/unexpected_error",
      "Unexpected error",
      "An unexpected error occurred",
    ),
  },
  { kind: "reset" },
] as const

/**
 * What a send can meet: the provider rate limiting the account (LinkedIn limits how many messages
 * and invitations it sends), the account's session having been disconnected, and a dropped answer
 * after the message went, which checks a retry does not message twice.
 */
const SEND_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { ...json, "retry-after": "60" },
    body: problem(
      429,
      "errors/too_many_requests",
      "Too many requests",
      "The provider limited this account",
    ),
  },
  {
    kind: "status",
    status: 401,
    headers: json,
    body: problem(
      401,
      "errors/disconnected_account",
      "Disconnected account",
      "The account's session expired; reconnect it",
    ),
  },
  { kind: "delay", ms: 30_000 },
  ...COMMON,
  { kind: "reset-after" },
] as const

/**
 * `danwo matrix`'s Unipile faults: the full set on sending messages, starting chats and sending
 * mail, a disconnected account and server errors on reads; the hosted auth pages are left alone.
 */
export function unipileOutboundFaults(call: { host?: string; method: string; path: string }) {
  if (call.host === "account.unipile.com" || !call.path.startsWith("/api/v1/")) return []
  if (call.method === "POST" && /\/(chats(\/[^/]+\/messages)?|emails)$/.test(call.path))
    return SEND_FAULTS

  return [SEND_FAULTS[1], ...COMMON]
}
