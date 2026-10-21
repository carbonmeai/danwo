import { fileURLToPath } from "node:url"

import { defineConfig, githubEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"
import { fakeKey } from "../fake-key.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const BOT_TOKEN = fakeKey("ghp_", "thanksBotThanksBotThanksBot01")
const ADA_TOKEN = fakeKey("ghp_", "adaLovelaceAdaLovelaceAda0001")
const WEBHOOK_SECRET = "thanks-bot-webhook-secret"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const github = await githubEnvironment({
      seed: () => ({
        users: [{ login: "ada", name: "Ada Lovelace" }, { login: "thanks-bot" }],
        repos: [{ repo: "ada/widgets" }],
        tokens: [
          { token: ADA_TOKEN, login: "ada" },
          { token: BOT_TOKEN, login: "thanks-bot" },
        ],
        hooks: [
          {
            repo: "ada/widgets",
            url: `http://127.0.0.1:${port}/github`,
            secret: WEBHOOK_SECRET,
            events: ["issues"],
          },
        ],
      }),
    })

    const start = () =>
      launchApp(APP, port, {
        ...github.proxy.env(),
        BOT_TOKEN,
        WEBHOOK_SECRET,
        ...(process.env.GITHUB_BUG && { GITHUB_BUG: process.env.GITHUB_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: github.proxy,
      webhooks: github.webhooks,
      fixtures: { ...github.fixtures, adaToken: ADA_TOKEN },
      settle: github.settle,
      async reset() {
        app.kill()
        await github.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await github.close()
      },
    }
  },
})
