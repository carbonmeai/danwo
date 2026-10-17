const json = { "content-type": "application/json; charset=utf-8" }
const apiBody = (error: string) => JSON.stringify({ ok: false, error })

/**
 * How long Slack asks a rate-limited caller to wait, by method. Slack groups methods into tiers
 * (Tier 1 about one call a minute up to Tier 4 about a hundred) and gives `chat.postMessage` its
 * own limit of about one message a second per channel. These waits are approximations.
 */
const RETRY_AFTER: Readonly<Record<string, number>> = {
  "chat.postMessage": 1,
  "chat.update": 3,
  "chat.delete": 3,
  "chat.postEphemeral": 3,
  "chat.scheduleMessage": 3,
  "conversations.list": 20,
  "conversations.history": 3,
  "conversations.replies": 3,
  "conversations.create": 20,
  "conversations.invite": 3,
  "users.list": 20,
  "files.getUploadURLExternal": 20,
  "files.completeUploadExternal": 20,
  "oauth.v2.access": 60,
}

/** Methods that change something, where a dropped connection after Slack acted matters. */
const WRITES = new Set([
  "chat.postMessage",
  "chat.update",
  "chat.delete",
  "chat.postEphemeral",
  "chat.scheduleMessage",
  "conversations.create",
  "conversations.invite",
  "conversations.join",
  "conversations.open",
  "reactions.add",
  "reactions.remove",
  "views.open",
  "views.update",
  "views.publish",
  "files.completeUploadExternal",
  "oauth.v2.access",
])

/** The faults every Web API method can meet. */
function apiFaults(method: string) {
  const wait = String(RETRY_AFTER[method] ?? 3)

  return [
    {
      kind: "status",
      status: 429,
      headers: { ...json, "retry-after": wait },
      body: apiBody("ratelimited"),
    },
    { kind: "status", status: 500, headers: json, body: apiBody("internal_error") },
    { kind: "status", status: 503, headers: json, body: apiBody("service_unavailable") },
    { kind: "status", status: 200, headers: json, body: apiBody("token_revoked") },
    { kind: "delay", ms: 10_000 },
    { kind: "reset" },
    ...(WRITES.has(method) ? [{ kind: "reset-after" } as const] : []),
  ] as const
}

/** The faults an incoming webhook or `response_url` post can meet; Slack answers these in text. */
const HOOK_FAULTS = [
  {
    kind: "status",
    status: 429,
    headers: { "content-type": "text/plain", "retry-after": "1" },
    body: "rate_limited",
  },
  {
    kind: "status",
    status: 500,
    headers: { "content-type": "text/plain" },
    body: "internal_error",
  },
  { kind: "reset" },
  { kind: "reset-after" },
] as const

/**
 * Failures a call to Slack can meet, as the fault matrix injects them at the proxy:
 * - every Web API method: Slack's 429 `ratelimited` with `Retry-After`, 500 and 503, a revoked
 *   token (HTTP 200 with `token_revoked`, as Slack answers it), a 10 s delay and a dropped
 *   connection; methods that change something also drop after Slack acted;
 * - incoming webhooks and `response_url` posts: 429, 500 and dropped connections;
 * - file uploads to `files.slack.com`: 500 and dropped connections.
 */
export function slackOutboundFaults(call: { method: string; path: string }) {
  const path = call.path.split("?")[0] ?? ""
  const method = /^\/api\/([\w.]+)$/.exec(path)?.[1]

  if (method !== undefined) return apiFaults(method)
  if (call.method !== "POST") return []
  if (/^\/(services|commands|actions)\//.test(path)) return HOOK_FAULTS
  if (path.startsWith("/upload/v1/"))
    return [{ kind: "status", status: 500, body: "internal_error" }, { kind: "reset" }] as const

  return []
}
