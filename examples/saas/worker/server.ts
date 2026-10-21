/**
 * The background worker: it serves Relay's Inngest functions at `/api/inngest`, which the Inngest
 * dev server (or Inngest Cloud) calls to run each job, and prints `worker ready` once it listens.
 */
import { createServer } from "node:http"

import { serve } from "inngest/node"

import { closeDatabase } from "../shared/db/client.ts"
import { inngest } from "../shared/events.ts"
import { functions } from "./functions.ts"
import { settings } from "./settings.ts"

const handler = serve({ client: inngest, functions })

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/inngest")) return void handler(req, res)

  res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}')
})

server.listen(settings.PORT, "127.0.0.1", () => console.log("worker ready"))

function stop(): void {
  server.close(() => {
    void closeDatabase().finally(() => process.exit(0))
  })
  server.closeIdleConnections()
}

process.on("SIGTERM", stop)
process.on("SIGINT", stop)
