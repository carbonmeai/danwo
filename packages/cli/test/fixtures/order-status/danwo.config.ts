import { fileURLToPath } from "node:url"

import { defineConfig, stripeEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const WEBHOOK_SECRET = "whsec_order_status"

/** The order-status shop with a Stripe emulator that sends both payment intent events. */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    const port = await freePort()
    const url = `http://127.0.0.1:${port}`
    const stripe = await stripeEnvironment({
      seed: () => ({
        webhookEndpoints: [
          {
            url: `${url}/webhooks/stripe`,
            events: ["payment_intent.created", "payment_intent.succeeded"],
            secret: WEBHOOK_SECRET,
          },
        ],
      }),
    })
    const start = () =>
      launchApp(APP, port, {
        ...stripe.proxy.env(),
        STRIPE_SECRET_KEY: "REDACTED-TEST-VALUE",
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      })

    let app = await start()

    return {
      baseUrl: url,
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
