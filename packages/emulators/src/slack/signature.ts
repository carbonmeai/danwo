import { createHmac } from "node:crypto"

import type { WebhookEndpoint, WebhookSigner } from "../webhooks.ts"
import { topics } from "./events.ts"
import type { SlackStore } from "./store.ts"

/**
 * Slack's request signature: `X-Slack-Signature` is `v0=` and the hex HMAC-SHA256 of
 * `v0:{timestamp}:{body}` keyed with the app's signing secret; `X-Slack-Request-Timestamp` is the
 * Unix second the request was signed at. Verifiers refuse timestamps more than five minutes old.
 */
export function slackSignature(secret: string, timestamp: number, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`
}

/**
 * Where each app wants events, slash commands and interactions delivered, from its configuration.
 * Only installed apps are sent anything, but an app just uninstalled still gets told so. Slack
 * retries a failed event, but never a slash command or an interaction: a member is waiting on
 * those, and sees an error instead.
 */
export function deliveryEndpoints(slack: SlackStore): WebhookEndpoint[] {
  return slack.apps.all().flatMap((app) => {
    const endpoint = (id: string, url: string, retries: boolean) => ({
      id,
      url,
      events: [id],
      secret: app.signingSecret,
      enabled: true,
      retries,
    })
    const targets = [
      ...(app.eventsUrl === null ? [] : [endpoint(topics.events(app.appId), app.eventsUrl, true)]),
      ...(app.interactivityUrl === null
        ? []
        : [endpoint(topics.interactivity(app.appId), app.interactivityUrl, false)]),
      ...app.commands.map((setting) =>
        endpoint(topics.command(app.appId, setting.command), setting.url, false),
      ),
    ]

    return targets
  })
}

/** The id of an Events API delivery, so retries can be counted per event. */
function eventIdOf(body: string): string | undefined {
  return /"event_id":"([^"]+)"/.exec(body)?.[1]
}

/**
 * Signs each delivery. Events are JSON; commands and interactions are forms. Slack retries a failed
 * event with `X-Slack-Retry-Num` and `X-Slack-Retry-Reason`, so later attempts of the same event
 * carry them; a copy signed with a wrong secret is not counted as an attempt.
 */
export function slackSigner(): WebhookSigner {
  const attempts = new Map<string, number>()

  return ({ endpoint, body, timestamp }) => {
    const isEvent = endpoint.id.startsWith("events:")
    const headers: Record<string, string> = {
      "content-type": isEvent ? "application/json" : "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": slackSignature(endpoint.secret, timestamp, body),
    }
    const eventId = isEvent ? eventIdOf(body) : undefined

    if (eventId === undefined || isForged(endpoint)) return headers

    const seen = attempts.get(eventId) ?? 0

    attempts.set(eventId, seen + 1)

    return seen === 0
      ? headers
      : { ...headers, "x-slack-retry-num": String(seen), "x-slack-retry-reason": "http_error" }
  }
}

function isForged(endpoint: WebhookEndpoint): boolean {
  return endpoint.secret.endsWith("_forged")
}

/**
 * How Slack retries a failed event: soon after the failure, then after one and five minutes. An
 * app has three seconds to answer before the attempt counts as failed. Commands and interactions
 * are sent once.
 */
export const SLACK_DELIVERY = { retryDelaysMs: [1_000, 60_000, 300_000], timeoutMs: 3_000 }
