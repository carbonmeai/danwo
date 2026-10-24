import {
  appEnvironment,
  defineConfig,
  freePort,
  postgresSnapshot,
  resendService,
  startPostgresProxy,
  stripeService,
} from "@danwo/sdk"

import { sqlOn } from "./tests/db.ts"
import { BINARY, ensureBuilt, ROOT, WEB_DIST, workerDatabase } from "./tests/environment.ts"
import { STRIPE_SECRET_KEY, TEAM_PLAN, TEAM_PRICE_CENTS, upgrade } from "./tests/quillwork.ts"

/** Not a real secret: the emulator signs its webhooks with it, and the app checks them. */
const STRIPE_WEBHOOK_SECRET = "whsec_quillwork"

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 60_000,
  /*
   * After every action, wait until the app's calls to Stripe and Resend have finished and play the
   * webhooks they caused, so no test waits or settles by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  sessions: {
    /** A team already on the Team plan, for the agent test that reads the account page. */
    "team-account": {
      async setup({ app, screen, expect }) {
        await upgrade({ app, screen, expect }, { email: "ada@quillwork.test", team: "Lovelace" })
      },
    },
  },
  /*
   * The upgrade's plan is a little over the default budget of 40 trials, with the page's calls to
   * the API faulted beside Stripe's, Resend's and Postgres's: run all of it.
   */
  matrix: { workers: 4, budget: 50, pageCalls: true },
  async environment({ workerIndex }) {
    /*
     * The first worker builds the web app with Vite and the server with `go build`; the others
     * wait for it and run the same build.
     */
    await ensureBuilt()

    const database = await workerDatabase(workerIndex)
    /* The app connects through the data proxy, so the matrix can fault its statements. */
    const postgres = await startPostgresProxy({ upstream: database.url })
    const rows = postgresSnapshot({ url: database.url, strategy: "rows" })
    const url = `http://127.0.0.1:${await freePort()}`

    /* Stripe holds the Team plan's price, and calls the app's webhook. */
    const stripe = stripeService({
      seed: () => ({
        products: [{ id: "prod_team", name: "Quillwork Team" }],
        prices: [
          {
            id: TEAM_PLAN,
            product_name: "Quillwork Team",
            currency: "usd",
            unit_amount: TEAM_PRICE_CENTS,
            recurring: { interval: "month" },
          },
        ],
        webhookEndpoints: [
          {
            url: `${url}/webhooks/stripe`,
            events: [
              "checkout.session.completed",
              "customer.subscription.updated",
              "customer.subscription.deleted",
            ],
            secret: STRIPE_WEBHOOK_SECRET,
          },
        ],
      }),
    })
    const resend = resendService({ seed: { domains: [{ name: "quillwork.test" }] } })

    const app = await appEnvironment({
      app: {
        /*
         * One Go server answers the Vue app's files and its JSON API on one origin, so the page's
         * calls to the API carry the session cookie with no CORS. The server does not load danwo's
         * Node preload: it follows HTTPS_PROXY on its own, and trusts danwo's CA through the
         * SSL_CERT_FILE danwo sets for every app.
         */
        command: `exec "${BINARY}"`,
        cwd: ROOT,
        url,
        ready: { path: "/health" },
        env: {
          HOST: "127.0.0.1",
          APP_URL: url,
          DATABASE_URL: postgres.url(database.url),
          STRIPE_SECRET_KEY,
          STRIPE_WEBHOOK_SECRET,
          STRIPE_PRICE_ID: TEAM_PLAN,
          RESEND_API_KEY: "re_quillwork",
          SESSION_SECRET: "quillwork-test-session-secret",
          WEB_DIR: WEB_DIST,
        },
      },
      services: [stripe, resend],
      /* Every other outside host answers 502: the app can only reach what danwo emulates. */
      unmatched: "block",
    })

    return {
      ...app,
      data: [postgres],
      fixtures: { ...app.fixtures, sql: sqlOn(database.url) },
      async reset() {
        await app.reset?.()
        await database.empty()
      },
      /*
       * Every test starts from an empty database, or from a saved session's rows: the emulators
       * and the database keep one state per slot and put it back before each test and trial.
       */
      snapshotSlots: true,
      async snapshot(slot) {
        await app.snapshot?.(slot)
        await rows.snapshot(slot)
      },
      async restore(slot) {
        await app.restore?.(slot)
        await rows.restore(slot)
      },
      async close() {
        await app.close()
        await Promise.allSettled([rows.close(), postgres.close()])
        await database.close()
      },
    }
  },
})
