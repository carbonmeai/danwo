import { type ChatPostMessageArguments, WebClient } from "@slack/web-api"

import type { Emulator } from "../src/define.ts"
import type { SlackSeedConfig } from "../src/slack/index.ts"
import { fakeKey } from "./fake-key.ts"

/** The seeded app's fixed bot token. */
export const BOT_TOKEN = fakeKey("xoxb-", "1111111111111-2222222222222-seededbottoken0000000000")

export const APP = {
  name: "Standup Bot",
  app_id: "A0STANDUP01",
  client_id: "1111111111111.2222222222222",
  client_secret: "standup-client-secret",
  signing_secret: "standup-signing-secret",
  redirect_urls: ["https://app.danwo.test/slack/oauth"],
  bot_scopes: [
    "chat:write",
    "channels:read",
    "channels:history",
    "channels:join",
    "channels:manage",
    "groups:read",
    "im:write",
    "users:read",
    "users:read.email",
    "reactions:write",
    "reactions:read",
    "files:write",
    "app_mentions:read",
  ],
} as const

/** A workspace with three members, #general, #random and a private #leads, and the app installed. */
export const WORKSPACE: SlackSeedConfig = {
  team: { id: "T0DANWO0001", name: "Danwo QA" },
  users: [
    { name: "ada", email: "ada@danwo.test", real_name: "Ada Lovelace", is_admin: true },
    { name: "grace", email: "grace@danwo.test", real_name: "Grace Hopper" },
    { name: "alan", email: "alan@danwo.test", real_name: "Alan Turing" },
  ],
  channels: [
    { name: "random", members: ["ada", "grace"] },
    { name: "leads", is_private: true, members: ["ada"] },
  ],
  apps: [APP],
  installations: [{ app: APP.client_id, installer: "ada", bot_token: BOT_TOKEN }],
}

/** The official client, sending every request (API, uploads) straight to the emulator. */
export function clientFor(emulator: Emulator, token?: string): WebClient {
  return new WebClient(token, {
    fetch: (input, init) => emulator.fetch(new Request(input, init)),
    retryConfig: { retries: 0 },
  })
}

/**
 * `chat.postMessage` through the official client. The lint rule for `window.postMessage` mistakes
 * Slack's method for it, so it is turned off for this one call.
 */
export function postMessage(client: WebClient, args: ChatPostMessageArguments) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Slack's chat.postMessage
  return client.chat.postMessage(args)
}

/** The `data` of a Slack platform error the client threw, for asserting on it. */
export async function slackError(call: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await call
  } catch (error) {
    if (error instanceof Error && "data" in error && typeof error.data === "object" && error.data)
      return Object.fromEntries(Object.entries(error.data))

    throw error
  }

  throw new Error("expected the call to fail")
}
