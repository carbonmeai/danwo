import {
  clerkInstance,
  clerkService,
  defineConfig,
  freePort,
  googleService,
  inngestService,
  PUSHER_DEFAULTS,
  postgresSnapshot,
  pusherService,
  resendService,
  slackService,
  stackEnvironment,
  startPostgresProxy,
  stripeService,
} from "@danwo/sdk"

import { PLANS } from "./shared/plans.ts"
import { SLACK_SCOPES } from "./shared/slack.ts"
import { sqlOn } from "./tests/db.ts"
import { emptyDatabase, ensureBuilt, ROOT, workerDatabase } from "./tests/environment.ts"
import { ADA, connectSlack, onboard, signUp, WORKSPACE } from "./tests/relay.ts"

/** None of these is a real key: the emulators accept any well-formed one. */
const STRIPE_SECRET_KEY = "sk_test_relay_notes"
const STRIPE_WEBHOOK_SECRET = "whsec_relay_notes"
const SLACK_APP = {
  name: "Relay",
  client_id: "4100000000.4100000001",
  client_secret: "relay-slack-client-secret",
  signing_secret: "relay-slack-signing-secret",
}
const GOOGLE_CLIENT = {
  client_id: "relay-notes.apps.googleusercontent.com",
  client_secret: "relay-google-client-secret",
  name: "Relay",
}

const local = (port: number) => `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 120_000,
  /*
   * After every action, wait until the apps' calls to the providers have finished, the webhooks
   * they caused have landed and the Inngest jobs they started have run, so no test waits by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  sessions: {
    /** Ada, signed up, with the Acme workspace on its trial. */
    "owner-in-workspace": {
      async setup(fixtures) {
        await signUp(fixtures, ADA)
        await onboard(fixtures, WORKSPACE)
      },
    },
    /** The same, with Slack connected and notes going to #product. */
    "owner-with-slack": {
      async setup(fixtures) {
        await signUp(fixtures, ADA)
        await onboard(fixtures, WORKSPACE)
        await connectSlack(fixtures, "product")
      },
    },
  },
  matrix: { workers: 4, budget: 120 },
  async environment({ workerIndex }) {
    await ensureBuilt()

    const [web, api, worker, dev, gatewayPort, gatewayGrpcPort, executorGrpcPort] =
      await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ])
    const webUrl = local(web)
    const apiUrl = local(api)
    const workerUrl = local(worker)
    const devUrl = local(dev)

    /* Relay's own database, behind danwo's data proxy so the matrix can fault its statements. */
    const database = await workerDatabase(workerIndex)
    const postgres = await startPostgresProxy({ upstream: database.url })
    const rows = postgresSnapshot({ url: database.url, strategy: "rows" })

    const clerk = clerkService({
      seed: {
        instance: { slug: "relay-notes", origin: webUrl, password: false },
        webhooks: [{ endpoint: `${apiUrl}/webhooks/clerk`, events: ["user.created"] }],
      },
    })
    const stripe = stripeService({
      seed: () => ({
        products: PLANS.map((plan) => ({ id: `prod_${plan.key}`, name: plan.name })),
        prices: PLANS.map((plan) => ({
          id: `price_${plan.key}`,
          product_name: plan.name,
          currency: "usd",
          unit_amount: plan.priceCents,
          lookup_key: plan.key,
          nickname: `${plan.name} monthly`,
          recurring: { interval: "month" },
        })),
        webhookEndpoints: [
          {
            url: `${apiUrl}/webhooks/stripe`,
            events: [
              "customer.subscription.created",
              "customer.subscription.updated",
              "customer.subscription.deleted",
              "customer.subscription.trial_will_end",
              "invoice.paid",
              "invoice.payment_failed",
              "checkout.session.completed",
            ],
            secret: STRIPE_WEBHOOK_SECRET,
          },
        ],
      }),
    })
    const slack = slackService({
      seed: {
        team: { name: "Acme", domain: "acme" },
        users: [{ name: "ada", real_name: ADA.name, email: ADA.email, is_admin: true }],
        channels: [
          { name: "product", members: ["ada"], topic: "What we're building" },
          { name: "random", members: ["ada"] },
        ],
        apps: [
          {
            ...SLACK_APP,
            bot_scopes: SLACK_SCOPES,
            redirect_urls: [`${webUrl}/integrations/slack/callback`],
          },
        ],
      },
    })
    /* Ada's calendar has one meeting coming up, two days from whenever the worker starts. */
    const planning = new Date(Date.now() + 2 * 86_400_000)

    planning.setUTCHours(15, 0, 0, 0)

    const google = googleService({
      seed: {
        oauth_clients: [
          { ...GOOGLE_CLIENT, redirect_uris: [`${webUrl}/integrations/google/callback`] },
        ],
        users: [{ email: ADA.email, name: ADA.name }],
        calendar: {
          [ADA.email]: [
            {
              summary: "Planning with the team",
              start: { dateTime: planning.toISOString() },
              end: { dateTime: new Date(planning.getTime() + 3_600_000).toISOString() },
            },
          ],
        },
      },
    })
    const pusher = pusherService()
    const resend = resendService({ seed: { domains: [{ name: "relay.test" }] } })
    const inngest = await inngestService({ url: devUrl, settleTimeoutMs: 60_000 })
    const { app: pusherApp } = PUSHER_DEFAULTS
    const keys = () => clerkInstance(clerk.emulator).env()
    const pusherEnv = {
      PUSHER_APP_ID: pusherApp.id,
      PUSHER_KEY: pusherApp.key,
      PUSHER_SECRET: pusherApp.secret,
      PUSHER_CLUSTER: pusherApp.cluster,
    }

    const stack = await stackEnvironment({
      unmatched: "block",
      secrets: "fail",
      baseUrl: "web",
      services: [clerk, stripe, slack, google, pusher, resend, inngest],
      apps: [
        {
          name: "web",
          command: "node web/serve.ts",
          cwd: ROOT,
          url: webUrl,
          dependsOn: ["api"],
          env: () => ({ ...keys(), ...pusherEnv, API_URL: apiUrl, NODE_ENV: "production" }),
        },
        {
          name: "api",
          command: "node api/server.ts",
          cwd: ROOT,
          url: apiUrl,
          ready: { path: "/health" },
          dependsOn: ["inngest"],
          env: () => ({
            ...keys(),
            ...pusherEnv,
            ...inngest.env,
            WEB_URL: webUrl,
            DATABASE_URL: postgres.url(database.url),
            STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET,
            SLACK_CLIENT_ID: SLACK_APP.client_id,
            SLACK_CLIENT_SECRET: SLACK_APP.client_secret,
            GOOGLE_CLIENT_ID: GOOGLE_CLIENT.client_id,
            GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT.client_secret,
            STATE_SECRET: "relay-oauth-state-secret-for-tests",
          }),
        },
        {
          name: "worker",
          command: "node worker/server.ts",
          cwd: ROOT,
          url: workerUrl,
          ready: { log: "worker ready" },
          env: {
            ...inngest.env,
            WEB_URL: webUrl,
            DATABASE_URL: postgres.url(database.url),
            RESEND_API_KEY: "re_relay_notes",
          },
        },
        {
          /* The Inngest dev server, calling the worker for every job; its retries come a second apart. */
          name: "inngest",
          command: [
            "node_modules/.bin/inngest-cli dev --no-discovery",
            `--port ${dev} --connect-gateway-port ${gatewayPort}`,
            `--connect-gateway-grpc-port ${gatewayGrpcPort} --connect-executor-grpc-port ${executorGrpcPort}`,
            `--retry-interval 1 --tick 50 -u ${workerUrl}/api/inngest`,
          ].join(" "),
          cwd: ROOT,
          url: devUrl,
          dependsOn: ["worker"],
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
      /*
       * Every test starts from an empty database, or from a saved session's rows: the emulators and
       * the database keep one state per slot and put it back before each test and trial.
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
        await database.close()
      },
    }
  },
})
