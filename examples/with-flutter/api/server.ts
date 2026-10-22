/**
 * The waitlist API the app calls: `POST /join` with `{ email }` answers `{ status, count }`, or
 * `{ error }`. It starts on 127.0.0.1:$PORT and stops cleanly on SIGTERM.
 */
import { serve } from "@hono/node-server"
import { Hono } from "hono"

import { closeDatabase } from "./db.ts"
import { join, normalEmail } from "./waitlist.ts"

const app = new Hono()

app.get("/health", (c) => c.text("ok"))

app.post("/join", async (c) => {
  const body: unknown = await c.req.json().catch(() => undefined)
  const email = normalEmail(Reflect.get(Object(body), "email"))

  if (email === undefined) return c.json({ error: "Enter a valid email address." }, 400)

  try {
    return c.json(await join(email))
  } catch (error) {
    console.error("join failed:", error)

    return c.json({ error: "We couldn't add you just now. Please try again in a minute." }, 503)
  }
})

const server = serve(
  { fetch: app.fetch, port: Number(process.env.PORT ?? 8787), hostname: "127.0.0.1" },
  (info) => console.log(`listening ${info.port}`),
)

function stop(): void {
  server.close(() => {
    void closeDatabase().finally(() => process.exit(0))
  })
  /* Idle keep-alive connections would hold the close open. */
  if ("closeIdleConnections" in server) server.closeIdleConnections()
}

process.on("SIGTERM", stop)
process.on("SIGINT", stop)
