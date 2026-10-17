import { defineConfig, stripeEnvironment } from "@danwo/sdk"

import { launchShop, type Shop } from "./src/launch.ts"

const WEBHOOK_SECRET = "whsec_danwo_example"

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 60_000,
  /*
   * After every action, wait until the shop's calls to Stripe have finished and play the webhooks
   * they caused on the emulator's clock, so tests never wait or settle by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  // One Stripe emulator, proxy and shop per worker; `danwo matrix` resets them between runs.
  async environment() {
    let shop: Shop | undefined
    const stripe = await stripeEnvironment({
      seed: () =>
        shop && {
          webhookEndpoints: [
            {
              url: `${shop.url}/webhooks/stripe`,
              events: ["checkout.session.completed"],
              secret: WEBHOOK_SECRET,
            },
          ],
        },
    })

    const start = async () => {
      shop = await launchShop(
        stripe.proxy.env({
          ...process.env,
          STRIPE_SECRET_KEY: "sk_test_danwo_example",
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        }),
      )
      await stripe.reset()
    }

    await start()

    return {
      get baseUrl() {
        return shop?.url
      },
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      async reset() {
        await shop?.stop()
        await start()
      },
      async close() {
        await shop?.stop()
        await stripe.close()
      },
    }
  },
})
