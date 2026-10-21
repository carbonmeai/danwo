import { fileURLToPath } from "node:url"

import { defineConfig, stripeEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"
import { fakeKey } from "../fake-key.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const WEBHOOK_SECRET = fakeKey("whsec_", "stripePlan")
const LOOKUP_KEY = "pro_monthly"

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  async environment() {
    const port = await freePort()
    const stripe = await stripeEnvironment({
      seed: () => ({
        products: [{ name: "Pro" }],
        prices: [
          {
            product_name: "Pro",
            currency: "usd",
            unit_amount: 2000,
            lookup_key: LOOKUP_KEY,
            recurring: { interval: "month" },
          },
        ],
        webhookEndpoints: [
          {
            url: `http://127.0.0.1:${port}/webhooks/stripe`,
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
        ...stripe.proxy.env(),
        STRIPE_SECRET_KEY: fakeKey("sk_", "test_stripePlan"),
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        PRO_LOOKUP_KEY: LOOKUP_KEY,
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      travel: stripe.travel,
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
