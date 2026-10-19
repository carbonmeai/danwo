import {
  appEnvironment,
  composioService,
  defineConfig,
  postgresSnapshot,
  postgresWorkerDatabase,
  resendService,
  stripeService,
} from "@danwo/sdk"
import { Client } from "pg"

/**
 * Emulators only, plus a Postgres database when DANWO_PG_URL names a migrated one: tests change
 * them through their APIs and check what the next test starts from. FIXTURE_ISOLATION sets the
 * config's isolation, so the same tests show each mode.
 */
const ISOLATION = process.env.FIXTURE_ISOLATION
const BASE_URL = process.env.DANWO_PG_URL

/** The worker's database: its rows for tests, kept and restored with the emulators. */
async function workerDatabase(workerIndex: number) {
  if (BASE_URL === undefined) return undefined

  const url = await postgresWorkerDatabase(BASE_URL, workerIndex)
  const snapshot = postgresSnapshot({ url })

  /** Runs `sql` on its own connection, so a restore that closes sessions never breaks a test. */
  const query = async (sql: string) => {
    const client = new Client({ connectionString: url })

    await client.connect()

    try {
      return (await client.query<{ count?: string }>(sql)).rows
    } finally {
      await client.end()
    }
  }

  return { snapshot, query }
}

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  workers: 1,
  // The tests never open a page; a browser session still wants an address for the app.
  baseUrl: "http://127.0.0.1:9",
  ...((ISOLATION === "test" || ISOLATION === "file" || ISOLATION === "none") && {
    isolation: ISOLATION,
  }),
  async environment({ workerIndex }) {
    const env = await appEnvironment({
      services: [
        stripeService(),
        resendService(),
        composioService({ seed: { authConfigs: [{ id: "ac_seeded", toolkit: "gmail" }] } }),
      ],
    })
    const db = await workerDatabase(workerIndex)
    const orders = async () => Number((await db?.query("SELECT count(*) FROM orders"))?.[0]?.count)

    return {
      ...env,
      fixtures: {
        ...env.fixtures,
        orders,
        order: async () => db?.query("INSERT INTO orders (payment_intent) VALUES ('pi_1')"),
        database: db !== undefined,
      },
      async reset() {
        await env.reset?.()
        await db?.query("TRUNCATE orders")
      },
      async snapshot() {
        await env.snapshot?.()
        await db?.snapshot.snapshot()
      },
      async restore() {
        await env.restore?.()
        await db?.snapshot.restore()
      },
      async close() {
        await env.close()
        await db?.snapshot.close()
      },
    }
  },
})
