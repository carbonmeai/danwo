import { fileURLToPath } from "node:url"

import {
  defineConfig,
  type PostgresRestoreStrategy,
  postgresSnapshot,
  postgresWorkerDatabase,
  stripeEnvironment,
} from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"
import { rebuild } from "./schema.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

/*
 * The test sets DANWO_PG_URL to the migrated base database. DANWO_PG_MODE picks how trials start
 * clean: `snapshot` (restore a copy of the database) or `rebuild` (drop, migrate and seed again,
 * then restart the app), so the two can be timed against each other.
 */
const BASE_URL = process.env.DANWO_PG_URL ?? ""
const MODE = process.env.DANWO_PG_MODE ?? "snapshot"
const STRATEGY: PostgresRestoreStrategy =
  process.env.DANWO_PG_STRATEGY === "swap" ? "swap" : "recreate"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  // Each worker gets its own copy of the base database, so parallel trials never share rows.
  async environment({ workerIndex }) {
    const databaseUrl = await postgresWorkerDatabase(BASE_URL, workerIndex)
    const database = new URL(databaseUrl).pathname.slice(1)
    const stripe = await stripeEnvironment()
    const db = postgresSnapshot({ url: databaseUrl, strategy: STRATEGY })
    const port = await freePort()
    const start = () =>
      launchApp(APP, port, stripe.proxy.env({ ...process.env, DATABASE_URL: databaseUrl }))
    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: stripe.proxy,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      async reset() {
        app.kill()
        await rebuild(BASE_URL, database)
        await stripe.reset()
        app = await start()
      },
      ...(MODE === "snapshot" && {
        async snapshot() {
          await stripe.snapshot()
          await db.snapshot()
        },
        async restore() {
          await stripe.restore()
          await db.restore()
        },
      }),
      notes: () => [`database ${database}`],
      async close() {
        app.kill()
        await stripe.close()
        await db.close()
      },
    }
  },
})
