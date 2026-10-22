import {
  appEnvironment,
  clerkInstance,
  clerkService,
  defineConfig,
  googleService,
  postgresSnapshot,
  startPostgresProxy,
} from "@danwo/sdk"

import { ADA, ADAS_ORG, GOOGLE_CLIENT, LIN, SEED_ROWS, signIn } from "./tests/lumen.ts"
import { ensureBuilt, freePort } from "./tests/stack/next.ts"
import { workerDatabase } from "./tests/stack/postgres.ts"

/** The Clerk instance's slug: its Frontend API is `lumen.clerk.accounts.dev`. */
const SLUG = "lumen"

/** The events the app's webhook handles. */
const EVENTS = [
  "user.created",
  "user.updated",
  "user.deleted",
  "organizationMembership.created",
  "organizationMembership.updated",
  "organizationMembership.deleted",
]

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 90_000,
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  /*
   * After each action, wait for the page and for the calls it caused behind the app, and play the
   * webhooks Clerk sent, so no test waits or settles by hand.
   */
  readiness: { mode: "page+backend", settle: true },
  /*
   * The app reads Clerk's signing keys once per server and keeps them. The matrix runs the test
   * once before its clean run, so that read, which no faulted trial makes, gets no fault.
   */
  matrix: { warmUp: true },
  sessions: {
    /** Ada, signed in with an emailed code, in her personal account. */
    "signed-in-ada": {
      async setup(fixtures) {
        await signIn(fixtures, ADA.email)
      },
    },
    /** Ada, signed in, with her organization picked in Clerk's organization switcher. */
    "ada-org-owner": {
      async setup(fixtures) {
        const { screen, expect } = fixtures

        await signIn(fixtures, ADA.email)
        await screen.getByRole("button", { name: /Open organization switcher/i }).click()
        await screen.getByText(ADAS_ORG.name).click()
        await expect(screen.getByRole("heading", { name: ADAS_ORG.name })).toBeVisible()
      },
    },
  },
  async environment({ workerIndex }) {
    await ensureBuilt()

    const database = await workerDatabase(workerIndex)

    /* Ada and her membership, as the webhooks for Clerk's seeded records would have written them. */
    await database.empty(SEED_ROWS)
    /* The app connects through the data proxy, so the matrix can fault its statements. */
    const postgres = await startPostgresProxy({ upstream: database.url })
    /*
     * `rows` copies the tables back in place and closes no connection, so the app's pool keeps its
     * connections across restores.
     */
    const rows = postgresSnapshot({ url: database.url, strategy: "rows" })
    const port = await freePort()
    const url = `http://127.0.0.1:${port}`

    /* Google, with Lin's account and the OAuth client Clerk signs in with. */
    const google = googleService({
      seed: {
        users: [{ email: LIN.email, name: LIN.name }],
        oauth_clients: [
          {
            ...GOOGLE_CLIENT,
            name: "Lumen",
            redirect_uris: [`https://${SLUG}.clerk.accounts.dev/v1/oauth_callback`],
          },
        ],
      },
    })
    /*
     * A Clerk development instance that signs in by emailed code or with Google, with Ada and her
     * organization (their ids derived from her email and its slug, so the app's seeded rows match)
     * and the app's webhook.
     */
    const clerk = clerkService({
      social: [google],
      seed: {
        instance: { slug: SLUG, password: false, origin: url },
        social: [
          {
            provider: "google",
            clientId: GOOGLE_CLIENT.client_id,
            clientSecret: GOOGLE_CLIENT.client_secret,
          },
        ],
        users: [{ email: ADA.email, firstName: ADA.firstName, lastName: ADA.lastName }],
        organizations: [{ ...ADAS_ORG, members: [{ email: ADA.email, role: "org:admin" }] }],
        webhooks: [{ endpoint: `${url}/api/webhooks/clerk`, events: EVENTS }],
      },
    })
    const app = await appEnvironment({
      app: {
        command: `npm start -- --port ${port}`,
        url,
        env: {
          ...clerkInstance(clerk.emulator).env(),
          DATABASE_URL: postgres.url(database.url),
          NEXT_TELEMETRY_DISABLED: "1",
          CLERK_TELEMETRY_DISABLED: "1",
          ...(process.env.CLERK_LOGIN_BUG && { CLERK_LOGIN_BUG: process.env.CLERK_LOGIN_BUG }),
        },
      },
      services: [clerk, google],
      /* Every other outside host answers 502: the app can only reach what danwo emulates. */
      unmatched: "block",
    })

    return {
      ...app,
      data: [postgres],
      fixtures: { ...app.fixtures, databaseUrl: database.url },
      async reset() {
        await app.reset?.()
        await database.empty(SEED_ROWS)
      },
      /*
       * Every test starts from the seeded rows, or from a saved session's: the emulators and the
       * database keep one state per slot and put it back before each test and trial.
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
