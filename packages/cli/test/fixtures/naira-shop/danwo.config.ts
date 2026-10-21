import { fileURLToPath } from "node:url"

import { defineConfig, paystackEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"
import { fakeKey } from "../fake-key.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const SECRET = fakeKey("sk_", "test_4a1ra4a1ra4a1ra4a1ra4a1ra4a1ra4a1ra4a1ra4")

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const paystack = await paystackEnvironment({
      seed: {
        integrations: [
          { secretKey: SECRET, webhookUrl: `http://127.0.0.1:${port}/paystack/webhook` },
        ],
      },
    })

    const start = () =>
      launchApp(APP, port, {
        ...paystack.proxy.env(),
        PAYSTACK_SECRET_KEY: SECRET,
        ...(process.env.PAYSTACK_BUG && { PAYSTACK_BUG: process.env.PAYSTACK_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: paystack.proxy,
      webhooks: paystack.webhooks,
      fixtures: paystack.fixtures,
      settle: paystack.settle,
      async reset() {
        app.kill()
        await paystack.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await paystack.close()
      },
    }
  },
})
