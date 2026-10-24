import {
  defineConfig,
  postgresSnapshot,
  resendService,
  stackEnvironment,
  startPostgresProxy,
  stripeService,
} from "@danwo/sdk"

import { sqlOn } from "./tests/db.ts"
import {
  API_DIR,
  CLASSES,
  ensureBuilt,
  freePort,
  seedDatabase,
  stripePrice,
  syncPython,
  WEB_DIR,
  workerDatabase,
} from "./tests/environment.ts"
import { book, CUSTOMER, STRIPE_SECRET_KEY } from "./tests/studio.ts"

/** Not a real secret: the emulator signs its webhooks with whatever it is given. */
const STRIPE_WEBHOOK_SECRET = "whsec_fern_studio"

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 90_000,
  /*
   * After every action, wait until the site's calls to the API and the API's calls to Stripe and
   * Resend have finished, and play the webhooks they caused, so no test waits or settles by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  sessions: {
    /** A customer who has booked Sunrise flow already, for the "my bookings" tests. */
    "returning-customer": {
      async setup({ app, screen, expect }) {
        await book({ app, screen, expect }, { klass: "sunrise-flow", email: CUSTOMER })
      },
    },
  },
  matrix: { workers: 4, budget: 90, pageCalls: true },
  async environment({ workerIndex }) {
    await Promise.all([syncPython(), ensureBuilt()])

    const [apiPort, webPort] = await Promise.all([freePort(), freePort()])
    const local = (port: number) => `http://127.0.0.1:${port}`

    /* The API's own database, behind danwo's data proxy so the matrix can fault its statements. */
    const worker = await workerDatabase(workerIndex)
    const database = worker.url
    const postgres = await startPostgresProxy({ upstream: database })
    const rows = postgresSnapshot({ url: database, strategy: "rows" })

    /* Stripe sells each class at the price the timetable shows, and calls the API's webhook. */
    const stripe = stripeService({
      seed: () => ({
        products: CLASSES.map((klass) => ({ id: `prod_${klass.slug}`, name: klass.name })),
        prices: CLASSES.map((klass) => ({
          id: stripePrice(klass.slug),
          product_name: klass.name,
          currency: "usd",
          unit_amount: klass.priceCents,
        })),
        webhookEndpoints: [
          {
            url: `${local(apiPort)}/webhooks/stripe`,
            events: ["checkout.session.completed"],
            secret: STRIPE_WEBHOOK_SECRET,
          },
        ],
      }),
    })
    const resend = resendService({ seed: { domains: [{ name: "fernstudio.test" }] } })

    /*
     * Two apps, wired by their addresses. The API is Python, with no Node preload: it reaches the
     * emulators through the proxy variables danwo sets (HTTPS_PROXY and the rest) and trusts
     * danwo's CA through SSL_CERT_FILE and REQUESTS_CA_BUNDLE. The site is SvelteKit on Node, so
     * it gets the preload, and its server's calls to the API go through the proxy too. Every
     * other host is refused, and a live-looking key fails the start.
     */
    const stack = await stackEnvironment({
      unmatched: "block",
      secrets: "fail",
      baseUrl: "web",
      services: [stripe, resend],
      apps: [
        {
          name: "api",
          command: `uv run --no-sync uvicorn studio.app:app --host 127.0.0.1 --port ${apiPort}`,
          cwd: API_DIR,
          url: local(apiPort),
          ready: { path: "/health" },
          /* Stripe sends the customer back to the site, which may call the API from the browser. */
          env: ({ web = "" }) => ({
            DATABASE_URL: postgres.url(database),
            STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET,
            RESEND_API_KEY: "re_fern_studio",
            WEB_URL: web,
            PYTHONUNBUFFERED: "1",
          }),
        },
        {
          name: "web",
          command: "node server.ts",
          cwd: WEB_DIR,
          url: local(webPort),
          ready: { path: "/health" },
          dependsOn: ["api"],
          /* The server listens on PORT, which danwo sets from the URL, and HOST. */
          env: ({ api = "" }) => ({
            HOST: "127.0.0.1",
            API_URL: api,
            PUBLIC_API_URL: api,
          }),
        },
      ],
    })

    return {
      ...stack,
      data: [postgres],
      fixtures: { ...stack.fixtures, sql: sqlOn(database) },
      async reset() {
        await stack.reset?.()
        await seedDatabase(database)
      },
      /*
       * Every test starts from the seeded rows, or from a saved session's: the emulators and the
       * database keep one state per slot and put it back before each test and trial.
       */
      snapshotSlots: true,
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
        await worker.close()
      },
    }
  },
})
