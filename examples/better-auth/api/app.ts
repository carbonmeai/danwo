/**
 * Harbor's HTTP server: Better Auth under `/api/auth`, a health check, and the built web app for
 * every other path, so the browser sees one origin and Better Auth's cookies need no CORS.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getConnInfo } from "@hono/node-server/conninfo"
import { serveStatic } from "@hono/node-server/serve-static"
import { type Context, Hono } from "hono"

import { auth, CLIENT_IP_HEADER, pool } from "./auth.ts"
import { emailWentOut, oneCodeAtATime, oneSignInPerCode } from "./guards.ts"
import { describe } from "./retry.ts"
import { settings } from "./settings.ts"

/**
 * The request as Better Auth gets it, with the caller's address from the connection itself for
 * the rate limiter. A header the caller sent is replaced, never trusted, so nobody gets a fresh
 * allowance by making up an address. Behind a proxy you trust, take its `X-Forwarded-For` instead.
 */
function withClientAddress(c: Context): Request {
  const headers = new Headers(c.req.raw.headers)

  headers.set(CLIENT_IP_HEADER, getConnInfo(c).remote.address ?? "unknown")

  return new Request(c.req.raw, { headers })
}

export const app = new Hono()

app.get("/api/health", async (c) => {
  await pool.query("select 1")

  return c.json({ ok: true })
})

app.post("/api/auth/email-otp/send-verification-otp", oneCodeAtATime)
app.post("/api/auth/sign-in/email-otp", oneSignInPerCode)
app.post("/api/auth/send-verification-email", emailWentOut)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(withClientAddress(c)))
app.all("/api/*", (c) => c.json({ error: "Not found." }, 404))

if (settings.WEB_DIST !== undefined) {
  const root = settings.WEB_DIST
  const index = readFileSync(join(root, "index.html"), "utf8")

  app.use("/*", serveStatic({ root }))
  /* Every other path is one of the web app's own routes: it reads the URL and draws the page. */
  app.get("/*", (c) => c.html(index))
}

app.onError((error, c) => {
  console.error(`${c.req.method} ${c.req.path} failed: ${describe(error)}`)

  return c.json({ error: "Something went wrong. Please try again." }, 500)
})
