import {
  defineConfig,
  freePort,
  postgresSnapshot,
  resendService,
  s3Service,
  stackEnvironment,
  startPostgresProxy,
  stripeService,
} from "@danwo/sdk"

import { CATALOG, IMAGES_BUCKET, imageKey, imageOf } from "./seed/catalog.ts"
import { sqlOn } from "./tests/db.ts"
import { ensureBuilt, ROOT, seedDatabase, workerDatabase } from "./tests/environment.ts"
import { buy, CUSTOMER } from "./tests/shop.ts"

/** Not a real key: the emulators accept any well-formed one. */
const STRIPE_SECRET_KEY = "sk_test_paper_and_clay"
const STRIPE_WEBHOOK_SECRET = "whsec_paper_and_clay"

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 90_000,
  /*
   * After every action, wait until the apps' calls to Stripe, Resend and S3 have finished and play
   * the webhooks they caused, so no test waits or settles by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  sessions: {
    /** A customer who has bought a speckled mug already, for the refund and "my orders" tests. */
    "returning-customer": {
      async setup({ app, screen, expect }) {
        await buy({ app, screen, expect }, { product: "speckled-mug", email: CUSTOMER })
      },
    },
  },
  matrix: { workers: 4, budget: 90 },
  async environment({ workerIndex }) {
    await ensureBuilt()

    const [web, api] = await Promise.all([freePort(), freePort()])
    const apiUrl = `http://127.0.0.1:${api}`
    const webUrl = `http://127.0.0.1:${web}`

    /* The shop's own database, behind danwo's data proxy so the matrix can fault its statements. */
    const worker = await workerDatabase(workerIndex)
    const database = worker.url
    const postgres = await startPostgresProxy({ upstream: database })
    const rows = postgresSnapshot({ url: database, strategy: "rows" })

    /* Stripe holds the same products and prices as the database, and calls the API's webhook. */
    const stripe = stripeService({
      seed: () => ({
        products: CATALOG.map((product) => ({ id: `prod_${product.slug}`, name: product.name })),
        prices: CATALOG.map((product) => ({
          id: product.stripePrice,
          product_name: product.name,
          currency: "usd",
          unit_amount: product.priceCents,
        })),
        webhookEndpoints: [
          {
            url: `${apiUrl}/webhooks/stripe`,
            events: ["checkout.session.completed", "charge.refunded"],
            secret: STRIPE_WEBHOOK_SECRET,
          },
        ],
      }),
    })
    const resend = resendService({ seed: { domains: [{ name: "paperandclay.test" }] } })
    /* The product pictures, uploaded to the bucket the API reads them from. */
    const s3 = s3Service({
      seed: {
        buckets: [
          {
            name: IMAGES_BUCKET,
            objects: CATALOG.map((product) => ({
              key: imageKey(product.slug),
              body: imageOf(product.slug),
              contentType: "image/svg+xml",
            })),
          },
        ],
      },
    })

    const stack = await stackEnvironment({
      unmatched: "block",
      secrets: "fail",
      baseUrl: "web",
      services: [stripe, resend, s3],
      apps: [
        {
          name: "api",
          command: "node api/server.ts",
          cwd: ROOT,
          url: apiUrl,
          ready: { path: "/health" },
          env: {
            ...s3.env(),
            DATABASE_URL: postgres.url(database),
            STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET,
            RESEND_API_KEY: "re_paper_and_clay",
            IMAGES_BUCKET,
          },
        },
        {
          name: "web",
          command: `node node_modules/next/dist/bin/next start web --hostname 127.0.0.1 --port ${web}`,
          cwd: ROOT,
          url: webUrl,
          dependsOn: ["api"],
          env: { API_URL: apiUrl, SHOP_URL: webUrl, NEXT_TELEMETRY_DISABLED: "1" },
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
