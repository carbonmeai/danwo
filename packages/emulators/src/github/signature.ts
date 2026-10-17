import { createHash, createHmac } from "node:crypto"

import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import type { GithubAppRecord, GithubHookRecord, GithubRepoRecord } from "./entities.ts"
import { appTopic, hookTopic, pingTopic } from "./events.ts"
import { githubStore } from "./store.ts"

/** The events a hook subscribed to `*` gets. */
const REPO_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "push",
  "check_run",
]

/** Events every GitHub App gets, whatever it subscribed to. */
const APP_EVENTS = ["installation"]

/**
 * Endpoints are one per target and event (`hook:<id>:<event>:<repository id>`,
 * `app:<id>:<event>:<app id>`), so the signer knows which `X-GitHub-Event` to send.
 */
function hookEndpoints(hook: GithubHookRecord, repo: GithubRepoRecord): WebhookEndpoint[] {
  const events = hook.events.includes("*") ? REPO_EVENTS : hook.events
  const fullName = `${repo.owner}/${repo.name}`
  const endpoint = (event: string, topic: string) => ({
    id: `hook:${hook.ghId}:${event}:${repo.ghId}`,
    url: hook.url,
    events: [topic],
    secret: hook.secret,
    enabled: hook.active,
  })

  return [
    endpoint("ping", pingTopic(hook.ghId)),
    ...events.map((event) => endpoint(event, hookTopic(event, fullName))),
  ]
}

function appEndpoints(app: GithubAppRecord): WebhookEndpoint[] {
  return [...new Set([...app.events, ...APP_EVENTS])].map((event) => ({
    id: `app:${app.ghId}:${event}:${app.ghId}`,
    url: app.webhookUrl ?? "",
    events: [appTopic(event, app)],
    secret: app.webhookSecret,
    enabled: app.webhookUrl !== null,
  }))
}

/** Where GitHub delivers: every repository hook and every GitHub App's webhook URL. */
export function githubEndpoints(store: Store): WebhookEndpoint[] {
  const gh = githubStore(store)
  const hooks = gh.hooks.all().flatMap((hook) => {
    const repo = gh.repos.all().find((candidate) => candidate.id === hook.repoId)

    return repo ? hookEndpoints(hook, repo) : []
  })

  return [...hooks, ...gh.apps.all().flatMap(appEndpoints)]
}

/** A GUID for one delivery; a retry or a duplicate of the same delivery keeps it. */
function deliveryGuid(endpointId: string, body: string): string {
  const hex = createHash("sha256").update(`${endpointId}\n${body}`).digest("hex")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * The headers of one delivery, as GitHub sends them: the event, the delivery GUID, the hook and
 * what it is installed on, and, when the hook has a secret, `X-Hub-Signature-256` (HMAC-SHA256
 * of the body, hex) and the older SHA-1 `X-Hub-Signature`. GitHub's signatures carry no
 * timestamp, so a delivery signed "late" looks the same as any other.
 */
export function githubWebhookHeaders(
  endpoint: WebhookEndpoint,
  body: string,
): Record<string, string> {
  const [kind = "", id = "", event = "", target = ""] = endpoint.id.split(":")
  const sign = (algorithm: string) =>
    createHmac(algorithm, endpoint.secret).update(body).digest("hex")

  return {
    "content-type": "application/json",
    "user-agent": "GitHub-Hookshot/7e3d2f1",
    "x-github-event": event,
    "x-github-delivery": deliveryGuid(endpoint.id, body),
    "x-github-hook-id": id,
    "x-github-hook-installation-target-type": kind === "app" ? "integration" : "repository",
    "x-github-hook-installation-target-id": target,
    ...(endpoint.secret !== "" && {
      "x-hub-signature": `sha1=${sign("sha1")}`,
      "x-hub-signature-256": `sha256=${sign("sha256")}`,
    }),
  }
}

/** GitHub does not retry failed deliveries on its own, and gives each attempt ten seconds. */
export const GITHUB_DELIVERY = { retryDelaysMs: [], timeoutMs: 10_000 } as const
