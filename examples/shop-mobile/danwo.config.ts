import { fileURLToPath } from "node:url"

import {
  ANDROID_BACKGROUND_HOSTS,
  androidWorkers,
  IOS_BACKGROUND_HOSTS,
  iosWorkers,
  withAndroidDevice,
  withIosDevice,
} from "@danwo/device"
import { buildAndroid, buildIos } from "@danwo/expo"
import { forwardTo } from "@danwo/proxy"
import {
  defineConfig,
  type Service,
  startServices,
  stripeService,
  type WorkerEnvironment,
} from "@danwo/sdk"

import { launchShop, type Shop } from "./src/launch.ts"
import { scriptedModel } from "./src/scripted-model.ts"

const WEBHOOK_SECRET = "whsec_danwo_example"
/** The host the app calls; the proxy routes it to the shop's server on this machine. */
const SHOP_HOST = "shop.danwo.test"
const APP = fileURLToPath(new URL("./app", import.meta.url))
const AVD = process.env.DANWO_AVD ?? "danwo_spike"
/** `ios` runs the tests on an iOS Simulator; anything else, on an Android emulator. */
const IOS = process.env.DANWO_PLATFORM === "ios"
/** A model id to record agent steps with, or `scripted` for the shop's own scripted model. */
const MODEL = process.env.DANWO_MODEL

/**
 * The worker's iOS Simulator, bound to the services' proxy. The app is built once; an unchanged
 * app reuses its kept build. `DANWO_IOS_RUNTIME` picks the iOS danwo's simulator is created on.
 */
async function onIos(env: WorkerEnvironment, worker: number) {
  const build = await buildIos({ project: APP })
  const runtime = process.env.DANWO_IOS_RUNTIME

  return withIosDevice(env, {
    worker,
    ...(runtime !== undefined && { runtime }),
    app: { bundleId: "com.danwo.shopmobile", app: build.app, scheme: "danwoshop" },
  })
}

/** The worker's Android emulator, bound to the services' proxy; the APK is built once. */
async function onAndroid(env: WorkerEnvironment, worker: number) {
  const build = await buildAndroid({ project: APP })

  return withAndroidDevice(env, {
    avd: AVD,
    worker,
    /* A saved snapshot boots in seconds; without one the emulator boots cold. */
    ...(process.env.DANWO_AVD_SNAPSHOT !== undefined && {
      snapshot: process.env.DANWO_AVD_SNAPSHOT,
    }),
    app: { package: "com.danwo.shopmobile", apk: build.apk, scheme: "danwoshop" },
  })
}

export default defineConfig({
  testDir: "tests",
  /* Each worker boots its own device: as many as this machine has room for, at most three. */
  workers: IOS ? iosWorkers() : androidWorkers({ avd: AVD }),
  timeout: 120_000,
  readiness: { mode: "page+backend", settle: true },
  /* Agent steps record here and replay with no model; a model is needed only to record them. */
  cache: { dir: process.env.DANWO_CACHE_DIR ?? "tests/__recordings__" },
  ...(MODEL !== undefined && { model: MODEL === "scripted" ? scriptedModel : MODEL }),
  /*
   * The Stripe emulator and the shop's server behind one proxy, and a device bound to it: the
   * app's calls and the Checkout page (in a Custom Tab on Android, a Safari view on iOS) all go
   * through the proxy. Every test starts the app afresh (data cleared, permissions granted);
   * `danwo matrix` restores the services between runs.
   */
  async environment({ workerIndex }) {
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
    /* The device's own background calls (browser sync, platform services) never leave the machine. */
    const services = await startServices([stripe, backend], {
      blocked: IOS ? IOS_BACKGROUND_HOSTS : ANDROID_BACKGROUND_HOSTS,
    })

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

    return (IOS ? onIos : onAndroid)(
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
      workerIndex,
    )
  },
})
