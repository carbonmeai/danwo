import { fileURLToPath } from "node:url"

import { bachsEnvironment, defineConfig } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const API_KEY = "sk_sandbox_creditStore"
const WEBHOOK_SECRET = "REDACTED-TEST-VALUE"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const bachs = await bachsEnvironment({
      seed: () => ({
        webhookEndpoints: [
          {
            url: `http://127.0.0.1:${port}/webhooks/bachs`,
            events: ["collection.succeeded"],
            secret: WEBHOOK_SECRET,
          },
        ],
      }),
    })

    const start = () =>
      launchApp(APP, port, {
        ...bachs.proxy.env(),
        BACHS_API_KEY: API_KEY,
        BACHS_WEBHOOK_SECRET: WEBHOOK_SECRET,
        ...(process.env.BACHS_BUG && { BACHS_BUG: process.env.BACHS_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: bachs.proxy,
      webhooks: bachs.webhooks,
      fixtures: bachs.fixtures,
      settle: bachs.settle,
      async reset() {
        app.kill()
        await bachs.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await bachs.close()
      },
    }
  },
})
