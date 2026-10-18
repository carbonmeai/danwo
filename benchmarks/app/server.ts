/**
 * The benchmark app: one Node process serving every scenario the benchmark measures, plus a small
 * widget on a second origin for the cross-origin frame. Bugs are switched on with `BENCH_BUGS`.
 *
 * Env: PORT and WIDGET_PORT (0 picks one; the chosen ports are printed as `listening <port>`),
 * STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, SLACK_BOT_TOKEN, BENCH_BUGS.
 */
import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { text } from "node:stream/consumers"

import { bugsFrom } from "./bugs.ts"
import { widget } from "./pages.ts"
import { type Answer, type Context, freshState, routeFor } from "./routes.ts"

const bugs = bugsFrom(process.env.BENCH_BUGS)
let state = freshState()

const credentials = {
  stripeKey: process.env.STRIPE_SECRET_KEY ?? "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  resendKey: process.env.RESEND_API_KEY ?? "",
  slackToken: process.env.SLACK_BOT_TOKEN ?? "",
}

function portOf(server: Server): number {
  const address = server.address()

  return typeof address === "object" && address !== null ? address.port : 0
}

function send(res: ServerResponse, reply: Answer) {
  if ("redirect" in reply) {
    res.writeHead(303, { location: reply.redirect })
    res.end()
  } else if ("json" in reply) {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(reply.json)
  } else {
    res.writeHead(reply.status ?? 200, { "content-type": "text/html; charset=utf-8" })
    res.end(reply.html)
  }
}

async function contextOf(req: IncomingMessage, origins: { app: string; widget: string }) {
  const url = new URL(req.url ?? "/", origins.app)
  const body = req.method === "POST" ? await text(req) : ""
  const form = req.headers["content-type"]?.includes("form")
    ? new URLSearchParams(body)
    : new URLSearchParams()

  return {
    state,
    bugs,
    credentials,
    origin: origins.app,
    widgetOrigin: origins.widget,
    form,
    body,
    headers: req.headers,
    path: url.pathname,
    query: url.searchParams,
    resetState: () => {
      state = freshState()
    },
  } satisfies Context
}

async function answer(
  req: IncomingMessage,
  res: ServerResponse,
  origins: { app: string; widget: string },
) {
  const ctx = await contextOf(req, origins)
  const handler = routeFor(req.method ?? "GET", ctx.path)

  if (!handler) {
    res.writeHead(404)
    res.end("not found")

    return
  }

  try {
    send(res, await handler(ctx))
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" })
    res.end(error instanceof Error ? error.message : "error")
  }
}

const app = createServer()
const widgetServer = createServer()

app.listen(Number(process.env.PORT ?? 0), "127.0.0.1")
widgetServer.listen(Number(process.env.WIDGET_PORT ?? 0), "127.0.0.1")
await Promise.all([once(app, "listening"), once(widgetServer, "listening")])

/* The widget is served as `localhost`, a different origin from the app's `127.0.0.1`. */
const origins = {
  app: `http://127.0.0.1:${portOf(app)}`,
  widget: `http://localhost:${portOf(widgetServer)}`,
}

app.on("request", (req, res) => void answer(req, res, origins))
widgetServer.on("request", (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(widget(origins.app))
})

process.stdout.write(`listening ${portOf(app)}\n`)
