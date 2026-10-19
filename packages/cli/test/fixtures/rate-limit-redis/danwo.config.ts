import { fileURLToPath } from "node:url"

import { defineConfig, startRedisProxy, stripeEnvironment } from "@danwo/sdk"
import { Redis } from "ioredis"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

/**
 * The test sets DANWO_REDIS_URL to a Redis server; each worker counts in a database of its own.
 * The app reaches Redis through a fault proxy, so `danwo matrix` faults the commands each
 * sign-in attempt sends. It calls no provider; the Stripe environment is only its HTTP proxy.
 */
const SERVER = process.env.DANWO_REDIS_URL ?? ""

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment({ workerIndex }) {
    const url = `${SERVER}/${workerIndex + 1}`
    const cache = await startRedisProxy({ upstream: url, service: "cache" })
    const direct = new Redis(url)
    const services = await stripeEnvironment()
    const port = await freePort()
    const start = () =>
      launchApp(APP, port, { ...process.env, ...services.proxy.env(), REDIS_URL: cache.url(url) })
    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: services.proxy,
      data: [cache],
      async reset() {
        app.kill()
        await direct.flushdb()
        app = await start()
      },
      async close() {
        app.kill()
        direct.disconnect()
        await services.close()
        await cache.close()
      },
    }
  },
})
