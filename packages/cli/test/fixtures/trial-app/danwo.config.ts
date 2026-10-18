import { fileURLToPath } from "node:url"

import { bachsEnvironment, defineConfig } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const API_KEY = "sk_sandbox_trialApp"
const WEBHOOK_SECRET = "REDACTED-TEST-VALUE"
const PRO = "prod_pro_monthly"

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  async environment() {
    const port = await freePort()
    const bachs = await bachsEnvironment({
      seed: () => ({
        products: [
          {
            id: PRO,
            name: "Pro",
            price: { currency: "USD", amount: "20.00" },
            billing_cycle: { interval: "month", frequency: 1 },
            trial_period: { interval: "day", frequency: 14 },
          },
        ],
        webhookEndpoints: [
          {
            url: `http://127.0.0.1:${port}/webhooks/bachs`,
            events: [
              "customer.subscription.created",
              "customer.subscription.updated",
              "customer.subscription.deleted",
              "invoice.paid",
            ],
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
        PRO_PRODUCT: PRO,
        ...(process.env.TRIAL_BUG && { TRIAL_BUG: process.env.TRIAL_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: bachs.proxy,
      webhooks: bachs.webhooks,
      fixtures: bachs.fixtures,
      settle: bachs.settle,
      travel: bachs.travel,
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
