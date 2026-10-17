import { once } from "node:events"
import { createServer } from "node:http"

import { defineConfig, listeningPort, stripeEnvironment } from "@danwo/sdk"

import { pageEnvironment } from "../page-server.ts"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  matrix: { outboundFaults: () => [] },
  // A page to open, and a Stripe emulator whose customer webhooks go to a receiver that says 200.
  async environment({ workerIndex }) {
    const page = await pageEnvironment(workerIndex)
    const receiver = createServer((_req, res) => res.writeHead(200).end())

    receiver.listen(0, "127.0.0.1")
    await once(receiver, "listening")

    const url = `http://127.0.0.1:${listeningPort(receiver)}/webhooks`
    const stripe = await stripeEnvironment({
      seed: () => ({
        webhookEndpoints: [{ url, events: ["customer.created"], secret: "whsec_fixture" }],
      }),
    })

    return {
      baseUrl: page.baseUrl,
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      reset: () => stripe.reset(),
      async close() {
        receiver.close()
        await stripe.close()
        await page.close()
      },
    }
  },
})
