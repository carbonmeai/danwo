import { fileURLToPath } from "node:url"

import {
  defineConfig,
  postgresSnapshot,
  postgresWorkerDatabase,
  startPostgresProxy,
  stripeEnvironment,
} from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

/**
 * The test sets DANWO_PG_URL to the migrated base database and DANWO_BUG to the mistake the app
 * should make, if any. The app reaches its database through a fault proxy, so `danwo matrix`
 * plans faults on the statements each checkout sends.
 */
const BASE_URL = process.env.DANWO_PG_URL ?? ""

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment({ workerIndex }) {
    const databaseUrl = await postgresWorkerDatabase(BASE_URL, workerIndex)
    const postgres = await startPostgresProxy({ upstream: databaseUrl })
    const stripe = await stripeEnvironment()
    const db = postgresSnapshot({ url: databaseUrl })
    const port = await freePort()
    const env = stripe.proxy.env({ ...process.env, DATABASE_URL: postgres.url(databaseUrl) })
    let app = await launchApp(APP, port, env)

    /** A trial whose fault crashed the app leaves it down: the next one starts it again. */
    const revive = async () => {
      if (app.exitCode !== null || app.signalCode !== null) app = await launchApp(APP, port, env)
    }

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: stripe.proxy,
      data: [postgres],
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      async reset() {
        await stripe.reset()
        await revive()
      },
      async snapshot() {
        await stripe.snapshot()
        await db.snapshot()
      },
      async restore() {
        await stripe.restore()
        await db.restore()
        await revive()
      },
      async close() {
        app.kill()
        await stripe.close()
        await db.close()
        await postgres.close()
      },
    }
  },
})
