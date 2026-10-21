/**
 * The worker: serves the jobs at `/api/inngest` on 127.0.0.1:$PORT, where the Inngest dev server
 * calls them. Once it listens it registers its functions with the dev server (the `PUT` Inngest
 * makes when it syncs an app) and prints `worker ready`, so nothing is sent to a function the dev
 * server does not know yet.
 */
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { serve as inngestHandler } from "inngest/hono"

import { closeDatabase, describe } from "../db/client.ts"
import { inngest } from "../lib/inngest.ts"
import { functions } from "./functions.ts"

const port = Number(process.env.PORT ?? 4501)
const endpoint = `http://127.0.0.1:${port}/api/inngest`

const app = new Hono()
  .get("/health", (c) => c.json({ ok: true }))
  .on(["GET", "PUT", "POST"], "/api/inngest", inngestHandler({ client: inngest, functions }))

/** Registers the functions with the dev server, trying again while it is still starting. */
async function register(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(endpoint, { method: "PUT" })

      if (response.ok) return

      throw new Error(`${response.status} ${await response.text()}`)
    } catch (error) {
      if (attempt >= 40) throw error

      console.warn(`registering with Inngest: ${describe(error)}; trying again`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  register().then(
    () => console.log("worker ready"),
    (error: unknown) => {
      console.error(`could not register with Inngest: ${describe(error)}`)
      process.exit(1)
    },
  )
})

function stop(): void {
  server.close(() => {
    void closeDatabase().finally(() => process.exit(0))
  })
  if ("closeIdleConnections" in server) server.closeIdleConnections()
}

process.on("SIGTERM", stop)
process.on("SIGINT", stop)
