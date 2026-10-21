/**
 * Starts the API on 127.0.0.1:$PORT and prints `listening <port>`. It stops cleanly on SIGTERM:
 * the server closes, then the database pool.
 */
import { serve } from "@hono/node-server"

import { app } from "./app.ts"
import { closeDatabase } from "./db/client.ts"
import { sendMissedReceipts } from "./receipts.ts"
import { describe } from "./retry.ts"
import { settings } from "./settings.ts"

const server = serve({ fetch: app.fetch, port: settings.PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`listening ${info.port}`)
  sendMissedReceipts().catch((error: unknown) =>
    console.warn(`missed receipts: ${describe(error)}`),
  )
})

function stop(): void {
  server.close(() => {
    void closeDatabase().finally(() => process.exit(0))
  })
  /* Idle keep-alive connections would hold the close open. */
  if ("closeIdleConnections" in server) server.closeIdleConnections()
}

process.on("SIGTERM", stop)
process.on("SIGINT", stop)
