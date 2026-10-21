/**
 * Relay's Slack client, the same for the API and the worker. The SDK's own retries are off: a
 * rate limit is thrown at once, and whoever called decides (the API answers with an error, the
 * worker lets Inngest retry the step later). The timeout is longer than any pause Slack takes, so a
 * slow `chat.postMessage` is waited for rather than sent a second time.
 */
import { ErrorCode, WebClient } from "@slack/web-api"

/** The scopes Relay asks for: post, list and join public channels, and read what it posted. */
export const SLACK_SCOPES = ["chat:write", "channels:read", "channels:join", "channels:history"]

/** A Web API client for `token`. */
export function slackClient(token?: string): WebClient {
  return new WebClient(token, {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: 15_000,
  })
}

/** The Slack error code a failed call answered with, such as `ratelimited` or `token_revoked`. */
export function slackError(error: unknown): string | undefined {
  const code: unknown = Reflect.get(Object(error), "code")

  if (code === ErrorCode.RateLimitedError) return "ratelimited"
  if (code === ErrorCode.PlatformError) {
    const data: unknown = Reflect.get(Object(error), "data")
    const reason: unknown = Reflect.get(Object(data), "error")

    return typeof reason === "string" ? reason : undefined
  }

  return undefined
}

/** Errors that mean the connection itself is gone: someone has to connect Slack again. */
export const DISCONNECTED = new Set([
  "token_revoked",
  "invalid_auth",
  "account_inactive",
  "not_authed",
  "missing_scope",
])
