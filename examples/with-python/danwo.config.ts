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
  CLASSES,
  freePort,
  ROOT,
  seedDatabase,
  stripePrice,
  syncPython,
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
   * After every action, wait until the app's calls to Stripe and Resend have finished and play
   * the webhooks they caused, so no test waits or settles by hand.
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
  matrix: { workers: 4, budget: 90 },
  async environment({ workerIndex }) {
    await syncPython()

    const url = `http://127.0.0.1:${await freePort()}`

    /* The app's own database, behind danwo's data proxy so the matrix can fault its statements. */
    const worker = await workerDatabase(workerIndex)
    const database = worker.url
    const postgres = await startPostgresProxy({ upstream: database })
    const rows = postgresSnapshot({ url: database, strategy: "rows" })

    /* Stripe sells each class at the price the timetable shows, and calls the app's webhook. */
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
            url: `${url}/webhooks/stripe`,
            events: ["checkout.session.completed"],
            secret: STRIPE_WEBHOOK_SECRET,
          },
        ],
      }),
    })
    const resend = resendService({ seed: { domains: [{ name: "fernstudio.test" }] } })

    /*
     * A Python app has no Node preload: it reaches the emulators through the proxy variables
     * danwo sets (HTTPS_PROXY and the rest) and trusts danwo's CA through SSL_CERT_FILE and
     * REQUESTS_CA_BUNDLE. Every other host is refused, and a live-looking key fails the start.
     */
    const stack = await stackEnvironment({
      unmatched: "block",
      secrets: "fail",
      services: [stripe, resend],
      apps: [
        {
          name: "studio",
          command: `uv run --no-sync uvicorn studio.app:app --host 127.0.0.1 --port ${new URL(url).port}`,
          cwd: ROOT,
          url,
          ready: { path: "/health" },
          env: {
            DATABASE_URL: postgres.url(database),
            STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET,
            RESEND_API_KEY: "re_fern_studio",
            PYTHONUNBUFFERED: "1",
          },
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
