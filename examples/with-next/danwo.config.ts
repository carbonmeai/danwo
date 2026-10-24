import {
  appEnvironment,
  defineConfig,
  freePort,
  postgresSnapshot,
  resendService,
  startPostgresProxy,
} from "@danwo/sdk"

import { ensureBuilt } from "./tests/stack/next.ts"
import { workerDatabase } from "./tests/stack/postgres.ts"

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 60_000,
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  /* After each action, wait for the page and for the calls it caused behind the app. */
  readiness: { mode: "page+backend", settle: true },
  /*
   * Each worker gets its own Postgres database, its own Resend emulator and its own Next.js server,
   * so tests in parallel never share a row or an inbox. `danwo matrix` restores them between trials.
   */
  async environment({ workerIndex }) {
    await ensureBuilt()

    const database = await workerDatabase(workerIndex)
    /* The app connects through the data proxy, so the matrix can fault its statements. */
    const postgres = await startPostgresProxy({ upstream: database.url })
    /*
     * `rows` copies the table back in place and closes no connection, so the app's pool keeps its
     * connections across restores.
     */
    const rows = postgresSnapshot({ url: database.url, strategy: "rows" })
    const port = await freePort()
    const app = await appEnvironment({
      app: {
        command: "npm start -- --hostname 127.0.0.1",
        url: `http://127.0.0.1:${port}`,
        env: {
          DATABASE_URL: postgres.url(database.url),
          RESEND_API_KEY: "re_danwo_example",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
      services: [resendService()],
      /* Every other outside host answers 502: the app can only reach what danwo emulates. */
      unmatched: "block",
    })

    return {
      ...app,
      data: [postgres],
      fixtures: { ...app.fixtures, databaseUrl: database.url },
      async reset() {
        await app.reset?.()
        await database.empty()
      },
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
