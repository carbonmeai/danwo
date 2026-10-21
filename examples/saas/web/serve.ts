/**
 * Serves the built web app on 127.0.0.1:$PORT: the browser's assets from `dist/client`, and every
 * page, server function and server route from the server build's fetch handler. It stops cleanly on
 * SIGTERM.
 */
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

const here = fileURLToPath(new URL(".", import.meta.url))
const { default: start } = (await import(
  new URL("dist/server/server.js", import.meta.url).href
)) as {
  readonly default: { fetch(request: Request): Promise<Response> }
}

const app = new Hono()
  .use("/assets/*", serveStatic({ root: `${here}dist/client` }))
  .all("*", (c) => start.fetch(c.req.raw))

const server = serve(
  { fetch: app.fetch, port: Number(process.env.PORT ?? 3010), hostname: "127.0.0.1" },
  (info) => console.log(`listening ${info.port}`),
)

function stop(): void {
  server.close(() => process.exit(0))
  if ("closeIdleConnections" in server) server.closeIdleConnections()
}

process.on("SIGTERM", stop)
process.on("SIGINT", stop)
