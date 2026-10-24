/**
 * The worker's backend: its own Postgres database, the Resend emulator, and the waitlist API,
 * started through danwo's proxy. The app calls the API at its production host, which the proxy
 * routes to this worker's API; the API's calls to Resend reach the emulator the same way.
 */
import { fileURLToPath } from "node:url"

import { forwardTo } from "@danwo/proxy"
import {
  appEnvironment,
  freePort,
  postgresSnapshot,
  resendService,
  type Service,
  startPostgresProxy,
  type WorkerEnvironment,
} from "@danwo/sdk"

import { workerDatabase } from "./postgres.ts"

/** The host the app calls, as it ships. */
export const API_HOST = "api.lumen.example"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

/**
 * The backend for worker `workerIndex`, with the device's own background hosts in `blocked`.
 * Every other outside host answers 502: the app and the API reach only what danwo emulates.
 */
export async function waitlistBackend(
  workerIndex: number,
  blocked: readonly string[],
): Promise<WorkerEnvironment> {
  const database = await workerDatabase(workerIndex)
  /* The API connects through the data proxy, so the matrix can fault its statements. */
  const postgres = await startPostgresProxy({ upstream: database.url })
  /* `rows` copies the table back in place and closes no connection, so the API keeps its pool. */
  const rows = postgresSnapshot({ url: database.url, strategy: "rows" })
  const url = `http://127.0.0.1:${await freePort()}`
  const api: Service = {
    name: "api",
    routes: [{ hosts: [API_HOST], handler: forwardTo(url) }],
    close: async () => undefined,
  }
  const backend = await appEnvironment({
    app: {
      command: "node api/server.ts",
      cwd: ROOT,
      url,
      ready: { path: "/health" },
      env: { DATABASE_URL: postgres.url(database.url), RESEND_API_KEY: "re_danwo_example" },
    },
    services: [resendService(), api],
    unmatched: "block",
    blocked,
  })

  return {
    ...backend,
    data: [postgres],
    fixtures: { ...backend.fixtures, databaseUrl: database.url },
    async reset() {
      await backend.reset?.()
      await database.empty()
    },
    async snapshot(slot) {
      await backend.snapshot?.(slot)
      await rows.snapshot(slot)
    },
    async restore(slot) {
      await backend.restore?.(slot)
      await rows.restore(slot)
    },
    async close() {
      await backend.close()
      await Promise.allSettled([rows.close(), postgres.close()])
      await database.close()
    },
  }
}
