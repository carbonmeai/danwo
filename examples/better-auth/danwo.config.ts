import {
  appEnvironment,
  defineConfig,
  githubService,
  googleService,
  postgresSnapshot,
  resendService,
  startPostgresProxy,
} from "@danwo/sdk"

import { ADA, GITHUB_CLIENT, GOOGLE_CLIENT, KAI, LIN, SEED_ROWS, signIn } from "./tests/harbor.ts"
import { ensureBuilt, freePort, ROOT, WEB_DIST } from "./tests/stack/build.ts"
import { workerDatabase } from "./tests/stack/postgres.ts"

/** Not real secrets: the emulators accept any well-formed key, and Better Auth any long secret. */
const SECRETS = {
  BETTER_AUTH_SECRET: "harbor-better-auth-secret-for-tests-only",
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT.client_id,
  GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT.client_secret,
  GITHUB_CLIENT_ID: GITHUB_CLIENT.clientId,
  GITHUB_CLIENT_SECRET: GITHUB_CLIENT.clientSecret,
  RESEND_API_KEY: "re_harbor_tests",
}

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 90_000,
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  /* After each action, wait for the page and for the calls it caused behind the app. */
  readiness: { mode: "page+backend", settle: true },
  sessions: {
    /** Ada, signed in with an emailed code. */
    "signed-in-ada": {
      async setup(fixtures) {
        await signIn(fixtures, ADA.email)
      },
    },
  },
  matrix: { workers: 4 },
  async environment({ workerIndex }) {
    await ensureBuilt()

    const port = await freePort()
    const url = `http://127.0.0.1:${port}`
    const bug = process.env.BETTER_AUTH_BUG
    const env = {
      ...SECRETS,
      BETTER_AUTH_URL: url,
      ...(bug !== undefined && { BETTER_AUTH_BUG: bug }),
    }
    const database = await workerDatabase(workerIndex, env)

    await database.empty(SEED_ROWS)
    /* The app connects through the data proxy, so the matrix can fault its statements. */
    const postgres = await startPostgresProxy({ upstream: database.url })
    /*
     * `rows` copies the tables back in place and closes no connection, so the app's pool keeps its
     * connections across restores.
     */
    const rows = postgresSnapshot({ url: database.url, strategy: "rows" })

    /* Google, with Ada's and Lin's accounts and Harbor's OAuth client. */
    const google = googleService({
      seed: {
        users: [
          { email: ADA.email, name: ADA.name },
          { email: LIN.email, name: LIN.name },
        ],
        oauth_clients: [
          { ...GOOGLE_CLIENT, name: "Harbor", redirect_uris: [`${url}/api/auth/callback/google`] },
        ],
      },
    })
    /* GitHub, with Ada's and Kai's accounts and Harbor's OAuth App. */
    const github = githubService({
      seed: {
        users: [
          { login: ADA.github, name: ADA.name, emails: [ADA.githubEmail] },
          { login: KAI.github, name: KAI.name, emails: [KAI.email] },
        ],
        oauthApps: [
          {
            ...GITHUB_CLIENT,
            name: "Harbor",
            owner: "harbor-team",
            callbackUrls: [`${url}/api/auth/callback/github`],
          },
        ],
      },
    })
    const resend = resendService({ seed: { domains: [{ name: "harbor.test" }] } })
    const app = await appEnvironment({
      app: {
        command: "node api/server.ts",
        cwd: ROOT,
        url,
        ready: { path: "/api/health" },
        env: {
          ...env,
          PORT: String(port),
          DATABASE_URL: postgres.url(database.url),
          WEB_DIST,
        },
      },
      services: [resend, google, github],
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
