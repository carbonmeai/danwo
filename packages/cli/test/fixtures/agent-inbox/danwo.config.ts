import { fileURLToPath } from "node:url"

import { composioEnvironment, defineConfig, googleService } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const API_KEY = "ak_inbox_test_key"
const WEBHOOK_SECRET = "inbox-webhook-secret"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const composio = await composioEnvironment({
      seed: {
        apiKeys: [API_KEY],
        authConfigs: [{ id: "ac_inboxGmail", toolkit: "gmail" }],
        webhook: { url: `http://127.0.0.1:${port}/webhooks/composio`, secret: WEBHOOK_SECRET },
      },
      backends: [googleService({ seed: { users: [{ email: "ada@inbox.test", name: "Ada Lovelace" }] } })],
    })
    const env = () => ({
      ...composio.proxy.env(),
      COMPOSIO_API_KEY: API_KEY,
      COMPOSIO_AUTH_CONFIG: "ac_inboxGmail",
      COMPOSIO_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ...(process.env.INBOX_BUG && { INBOX_BUG: process.env.INBOX_BUG }),
    })
    let app = await launchApp(APP, port, env())

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: composio.proxy,
      webhooks: composio.webhooks,
      fixtures: composio.fixtures,
      settle: composio.settle,
      async reset() {
        app.kill()
        await composio.reset()
        app = await launchApp(APP, port, env())
      },
      async close() {
        app.kill()
        await composio.close()
      },
    }
  },
})
