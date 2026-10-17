import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  createEmulator,
  type Emulator,
  type ManualClock,
  seedStripe,
  stripe,
} from "@danwo/emulators"
import { type Proxy, startProxy } from "@danwo/proxy"

const SHOP = fileURLToPath(new URL("../../../examples/shop/src/server.ts", import.meta.url))
const WEBHOOK_SECRET = "whsec_runner_tests"

export interface ShopEnvironment {
  readonly emulator: Emulator
  readonly proxy: Proxy
  /** The shop's base URL, `http://127.0.0.1:<port>`. */
  readonly shopUrl: string
  close(): Promise<void>
}

/** Starts the shop as its own process, routed through the proxy like any unmodified app. */
async function startShop(env: NodeJS.ProcessEnv): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [SHOP], { env, stdio: ["ignore", "pipe", "pipe"] })
  const port = await new Promise<string>((resolve, reject) => {
    let out = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString()
      const match = /listening (\d+)/.exec(out)

      if (match?.[1]) resolve(match[1])
    })
    child.once("exit", (code) => reject(new Error(`shop exited with ${code}`)))
  })

  return { url: `http://127.0.0.1:${port}`, child }
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
  const shop = await startShop(
    proxy.env({
      ...process.env,
      STRIPE_SECRET_KEY: "sk_test_runner",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PORT: "0",
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
      shop.child.kill()
      await proxy.stop()
      await emulator.close()
    },
  }
}
