import {
  defineConfig,
  inngestService,
  postgresSnapshot,
  resendService,
  stackEnvironment,
  startPostgresProxy,
  stripeService,
} from "@danwo/sdk"

import { CENTS_PER_EMAIL, EMAIL_PRICE, TEAM_CUSTOMER } from "./lib/inngest.ts"
import { sqlOn } from "./tests/db.ts"
import { emptyDatabase, ensureBuilt, freePort, ROOT, workerDatabase } from "./tests/environment.ts"

/** Not real keys: the emulators accept any well-formed one. */
const STRIPE_SECRET_KEY = "sk_test_northwind_digest"
const RESEND_API_KEY = "re_northwind_digest"

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 90_000,
  /*
   * After every action, wait until the apps' calls have finished and every Inngest run they
   * started is done, its fan-out and retries included, so no test waits by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  matrix: { workers: 4, budget: 90 },
  async environment({ workerIndex }) {
    await ensureBuilt()

    const [web, api, worker, inngestPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ])
    const local = (port: number) => `http://127.0.0.1:${port}`

    /* The digests' own database, behind danwo's data proxy so the matrix can fault its statements. */
    const database = await workerDatabase(workerIndex)
    const postgres = await startPostgresProxy({ upstream: database.url })
    const rows = postgresSnapshot({ url: database.url, strategy: "rows" })

    /*
     * An Inngest dev server of this worker's own, which calls the worker's functions; the apps send
     * it events through danwo's proxy, so settling waits for the runs and the matrix faults the sends.
     */
    const inngest = await inngestService({
      start: true,
      url: local(inngestPort),
      apps: [`${local(worker)}/api/inngest`],
    })
    /* Stripe holds the team account the emails are billed to, and the price of one email. */
    const stripe = stripeService({
      seed: () => ({
        customers: [{ id: TEAM_CUSTOMER, name: "Northwind team", email: "billing@northwind.test" }],
        products: [{ id: "prod_digest_emails", name: "Digest emails" }],
        prices: [
          {
            id: EMAIL_PRICE,
            product_name: "Digest emails",
            currency: "usd",
            unit_amount: CENTS_PER_EMAIL,
          },
        ],
      }),
    })
    const resend = resendService({ seed: { domains: [{ name: "northwind.test" }] } })
    /*
     * Each app sends events with a key of its own, as deployed apps do, so the matrix sees the
     * API's send (`/e/digests-api`) and the worker's fan-out (`/e/digests-worker`) as two calls.
     */
    const appEnv = {
      ...inngest.env,
      DATABASE_URL: postgres.url(database.url),
      STRIPE_SECRET_KEY,
      RESEND_API_KEY,
    }

    const stack = await stackEnvironment({
      unmatched: "block",
      secrets: "fail",
      baseUrl: "web",
      services: [inngest, stripe, resend],
      apps: [
        {
          name: "worker",
          command: "node worker/server.ts",
          cwd: ROOT,
          url: local(worker),
          ready: { log: "worker ready" },
          env: { ...appEnv, INNGEST_EVENT_KEY: "digests-worker" },
        },
        {
          name: "api",
          command: "node api/server.ts",
          cwd: ROOT,
          url: local(api),
          ready: { path: "/health" },
          dependsOn: ["worker"],
          env: { ...appEnv, INNGEST_EVENT_KEY: "digests-api" },
        },
        {
          name: "web",
          command: `node node_modules/vite/bin/vite.js preview web --host 127.0.0.1 --port ${web} --strictPort`,
          cwd: ROOT,
          url: local(web),
          dependsOn: ["api"],
          env: { API_URL: local(api) },
        },
      ],
    })

    return {
      ...stack,
      data: [postgres],
      fixtures: { ...stack.fixtures, sql: sqlOn(database.url) },
      async reset() {
        await stack.reset?.()
        await emptyDatabase(database.url)
      },
      /* Every test starts from empty tables: the emulators and the database are put back first. */
      async snapshot(slot) {
        await stack.snapshot?.(slot)
        await rows.snapshot(slot)
      },
      async restore(slot) {
        await stack.restore?.(slot)
        await rows.restore(slot)
      },
      async close() {
        await stack.close()
        await Promise.allSettled([rows.close(), postgres.close()])
        await database.close()
      },
    }
  },
})
