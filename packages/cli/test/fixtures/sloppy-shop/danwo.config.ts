import { fileURLToPath } from "node:url"

import { defineConfig, stripeEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"
import { fakeKey } from "../fake-key.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    const port = await freePort()
    const stripe = await stripeEnvironment()
    const start = () =>
      launchApp(APP, port, {
        ...stripe.proxy.env(),
        STRIPE_SECRET_KEY: fakeKey("sk_", "test_sloppysloppysloppysloppy"),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      async reset() {
        app.kill()
        await stripe.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await stripe.close()
      },
    }
  },
})
