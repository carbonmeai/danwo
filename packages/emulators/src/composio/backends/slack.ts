/** Slack tools, run on the Slack emulator's Web API. */
import { asRecord } from "../../json.ts"
import { seedSlack } from "../../slack/seed.ts"
import { slackStore } from "../../slack/store.ts"
import { TOOLKITS } from "../catalog.ts"
import { OAUTH_CALLBACK } from "../helpers.ts"
import {
  arg,
  argNumber,
  type Backend,
  type BackendAnswer,
  type Executor,
  failed,
  type Send,
  tokenEndpoint,
  withQuery,
} from "./backend.ts"

const API = "https://slack.com/api"

/**
 * Calls a Web API method. Slack answers 200 with `ok: false` for a refused call, which Composio
 * reports as an unsuccessful execution with Slack's error code.
 */
async function slackCall(
  send: Send,
  token: string,
  method: string,
  args: Readonly<Record<string, unknown>>,
): Promise<BackendAnswer> {
  const response = await send(
    new Request(`${API}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(args),
    }),
  )
  const data: unknown = await response.json().catch(() => ({}))
  const body = asRecord(data)

  if (!response.ok) return failed(response.status, data)
  if (body?.["ok"] !== true)
    return {
      status: response.status,
      data,
      error: typeof body?.["error"] === "string" ? body["error"] : "slack_error",
    }

  return { status: response.status, data }
}

const tools: Record<string, Executor> = {
  SLACK_SEND_MESSAGE: ({ args, token, send }) =>
    slackCall(send, token, "chat.postMessage", {
      channel: arg(args, "channel"),
      text: arg(args, "text") ?? arg(args, "markdown_text"),
      ...(arg(args, "markdown_text") !== undefined && { mrkdwn: true }),
      ...(arg(args, "thread_ts") !== undefined && { thread_ts: arg(args, "thread_ts") }),
    }),
  SLACK_LIST_ALL_CHANNELS: ({ args, token, send }) =>
    slackCall(send, token, "conversations.list", {
      limit: argNumber(args, "limit") ?? 100,
      types: arg(args, "types") ?? "public_channel",
    }),
}

const SCOPES = TOOLKITS.find((toolkit) => toolkit.slug === "slack")?.defaultScopes ?? []

export const slackBackend: Backend = {
  name: "slack",
  toolkits: ["slack"],
  managedClient: { client_id: "1000000001.1000000001", client_secret: "composio-managed-slack" },
  pkce: false,
  authorizeUrl: (client, scopes, state) =>
    withQuery("https://slack.com/oauth/v2/authorize", {
      client_id: client.client_id,
      redirect_uri: OAUTH_CALLBACK,
      scope: scopes.join(","),
      state,
    }),
  ...tokenEndpoint(`${API}/oauth.v2.access`),
  async whoami(send, token) {
    const answer = await slackCall(send, token, "auth.test", {})
    const body = asRecord(answer.data)
    const team = body?.["team"]
    const user = body?.["user"]

    return typeof user === "string" ? `${user}@${typeof team === "string" ? team : "slack"}` : null
  },
  register(emulator, client) {
    if (slackStore(emulator.store).apps.findOneBy("clientId", client.client_id)) return

    seedSlack(emulator.store, {
      apps: [
        {
          name: "Composio",
          ...client,
          signing_secret: "composio-managed-signing-secret",
          redirect_urls: [OAUTH_CALLBACK],
          bot_scopes: [...SCOPES],
        },
      ],
    })
  },
  apiBase: () => API,
  tools,
}
