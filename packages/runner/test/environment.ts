import {
  createEmulator,
  type Emulator,
  type ManualClock,
  seedStripe,
  stripe,
} from "@danwo/emulators"
import { type Proxy, startProxy } from "@danwo/proxy"

import { launchShop } from "../../../examples/shop/src/launch.ts"

const WEBHOOK_SECRET = "whsec_runner_tests"

export interface ShopEnvironment {
  readonly emulator: Emulator
  readonly proxy: Proxy
  /** The shop's base URL, `http://127.0.0.1:<port>`. */
  readonly shopUrl: string
  close(): Promise<void>
}

/**
 * The Stripe emulator at checkout.stripe.com, a proxy routing Stripe's hosts to it, and the
 * example shop running through that proxy with its webhook endpoint seeded.
 */
export async function startShopEnvironment(
  options: {
    /** Drive webhook delivery and retries from this clock instead of real time. */
    readonly clock?: ManualClock
    /** Extra environment for the shop, e.g. `SHOP_BUG`. */
    readonly shopEnv?: Readonly<Record<string, string>>
  } = {},
): Promise<ShopEnvironment> {
  const emulator = createEmulator(stripe, {
    baseUrl: "https://checkout.stripe.com",
    ...(options.clock && { clock: options.clock.clock, timer: options.clock.timer }),
  })
  const proxy = await startProxy({
    routes: [{ hosts: ["api.stripe.com", "checkout.stripe.com"], handler: emulator.fetch }],
  })
  const shop = await launchShop(
    proxy.env({
      ...process.env,
      STRIPE_SECRET_KEY: "sk_test_runner",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ...options.shopEnv,
    }),
  )

  seedStripe(emulator.store, {
    webhookEndpoints: [
      {
        url: `${shop.url}/webhooks/stripe`,
        events: ["checkout.session.completed"],
        secret: WEBHOOK_SECRET,
      },
    ],
  })

  return {
    emulator,
    proxy,
    shopUrl: shop.url,
    async close() {
      await shop.stop()
      await proxy.stop()
      await emulator.close()
    },
  }
}
