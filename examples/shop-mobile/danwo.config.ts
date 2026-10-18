import { fileURLToPath } from "node:url"

import { withAndroidDevice } from "@danwo/device"
import { buildAndroid } from "@danwo/expo"
import { forwardTo } from "@danwo/proxy"
import { defineConfig, type Service, startServices, stripeService } from "@danwo/sdk"

import { launchShop, type Shop } from "./src/launch.ts"

const WEBHOOK_SECRET = "whsec_danwo_example"
/** The host the app calls; the proxy routes it to the shop's server on this machine. */
const SHOP_HOST = "shop.danwo.test"
const APP = fileURLToPath(new URL("./app", import.meta.url))

export default defineConfig({
  testDir: "tests",
  /* One emulator, so one worker. */
  workers: 1,
  timeout: 120_000,
  readiness: { mode: "page+backend", settle: true },
  /*
   * The Stripe emulator and the shop's server behind one proxy, and an Android emulator bound to
   * it: the app's calls and the Checkout page in its Custom Tab all go through the proxy. Every
   * test starts the app afresh (data cleared, permissions granted); `danwo matrix` restores the
   * services between runs.
   */
  async environment() {
    /* Built once; an unchanged app reuses its kept APK. */
    const build = await buildAndroid({ project: APP })
    let shop: Shop | undefined
    const stripe = stripeService({
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
    const backend: Service = {
      name: "shop",
      routes: [
        {
          hosts: [SHOP_HOST],
          handler: async (request) =>
            shop ? forwardTo(shop.url)(request) : new Response("shop not started", { status: 503 }),
        },
      ],
      close: async () => undefined,
    }
    const services = await startServices([stripe, backend])

    const start = async () => {
      shop = await launchShop(
        services.proxy.env({
          ...process.env,
          STRIPE_SECRET_KEY: "sk_test_danwo_example",
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
          SHOP_TEST_RESET: "1",
        }),
      )
      await services.reset()
    }

    await start()

    return withAndroidDevice(
      {
        get baseUrl() {
          return shop?.url
        },
        proxy: services.proxy,
        webhooks: services.webhooks,
        fixtures: services.fixtures,
        settle: () => services.settle(),
        travel: (ms) => services.travel(ms),
        async reset() {
          await shop?.stop()
          await start()
        },
        snapshot: () => services.snapshot(),
        async restore() {
          await services.restore()
          await fetch(`${shop?.url ?? ""}/__test/reset`, { method: "POST" })
        },
        async close() {
          await shop?.stop()
          await services.close()
        },
      },
      {
        avd: process.env.DANWO_AVD ?? "danwo_spike",
        app: { package: "com.danwo.shopmobile", apk: build.apk, scheme: "danwoshop" },
      },
    )
  },
})
