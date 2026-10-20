import { appendFileSync } from "node:fs"
import { join } from "node:path"

import {
  appEnvironment,
  composioService,
  defineConfig,
  type Emulator,
  postgresSnapshot,
  postgresWorkerDatabase,
  resendService,
  stripeService,
} from "@danwo/sdk"
import { Client } from "pg"

/**
 * Emulators only, plus a Postgres database when DANWO_PG_URL names a migrated one: tests change
 * them through their APIs and check what the next test starts from. FIXTURE_ISOLATION sets the
 * config's isolation, so the same tests show each mode. FIXTURE_ONE_SLOT keeps a single
 * snapshot, as an environment without `snapshotSlots` does.
 */
const ISOLATION = process.env.FIXTURE_ISOLATION
const BASE_URL = process.env.DANWO_PG_URL
const ONE_SLOT = process.env.FIXTURE_ONE_SLOT === "1"

/** Whether a fixture is an emulator, which answers requests in-process. */
function isEmulator(value: unknown): value is Emulator {
  return typeof value === "object" && value !== null && "fetch" in value
}

/** Signs the member in on the backend: one Stripe customer, and a line saying the setup ran. */
async function signInMember(fixtures: Readonly<Record<string, unknown>>): Promise<void> {
  const { stripe } = fixtures

  if (!isEmulator(stripe)) throw new Error("the member's sign-in needs the stripe fixture")

  await stripe.fetch(
    new Request("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        authorization: "Bearer sk_test_x",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "email=member@shop.test",
    }),
  )
  appendFileSync(join(process.env.DANWO_FIXTURE_STATE ?? ".", "setups.jsonl"), "member\n")
}

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
  sessions: { member: { setup: signInMember } },
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
      async snapshot(slot?: string) {
        await env.snapshot?.(slot)
        await db?.snapshot.snapshot(slot)
      },
      async restore(slot?: string) {
        await env.restore?.(slot)
        await db?.snapshot.restore(slot)
      },
      snapshotSlots: !ONE_SLOT && env.snapshotSlots === true,
      async close() {
        await env.close()
        await db?.snapshot.close()
      },
    }
  },
})
