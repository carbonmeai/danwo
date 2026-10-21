import { fileURLToPath } from "node:url"

import { defineConfig, slackEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"
import { fakeKey } from "../fake-key.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const BOT_TOKEN = fakeKey("xoxb-", "mention-bot-fixture")
const SIGNING_SECRET = "mention-bot-signing-secret"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const slack = await slackEnvironment({
      seed: () => ({
        users: [{ name: "ada", real_name: "Ada Lovelace" }],
        apps: [
          {
            name: "Mention Bot",
            app_id: "A0MENTIONBOT",
            client_id: "1001.2002",
            client_secret: "mention-bot-client-secret",
            signing_secret: SIGNING_SECRET,
            bot_scopes: ["app_mentions:read", "chat:write"],
            events: { url: `http://127.0.0.1:${port}/slack/events`, bot_events: ["app_mention"] },
          },
        ],
        installations: [{ app: "Mention Bot", bot_token: BOT_TOKEN, channels: ["general"] }],
      }),
    })

    const start = () =>
      launchApp(APP, port, {
        ...slack.proxy.env(),
        BOT_TOKEN,
        SIGNING_SECRET,
        ...(process.env.SLACK_BUG && { SLACK_BUG: process.env.SLACK_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: slack.proxy,
      webhooks: slack.webhooks,
      fixtures: { ...slack.fixtures, botToken: BOT_TOKEN },
      settle: slack.settle,
      async reset() {
        app.kill()
        await slack.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await slack.close()
      },
    }
  },
})
