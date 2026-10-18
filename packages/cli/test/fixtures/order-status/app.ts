/*
 * A shop that tracks each order's status from Stripe's webhooks: `payment_intent.created` marks it
 * pending, `payment_intent.succeeded` marks it paid. The careful shop never moves a paid order back
 * to pending, whatever order the events arrive in. `ORDER_BUG=reorder` sets whatever status the
 * latest event says, so a `created` that arrives late undoes the payment.
 *
 * Env: PORT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ORDER_BUG.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { z } from "zod"

const SECRET = process.env["STRIPE_SECRET_KEY"] ?? ""
const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] ?? ""
const BASE = `http://127.0.0.1:${process.env["PORT"]}`
const trustsLatest = process.env["ORDER_BUG"] === "reorder"

const Session = z.object({ url: z.string() })
const Event = z.object({
  type: z.string(),
  data: z.object({ object: z.object({ id: z.string() }) }),
})

/** Each payment intent's status, as the shop has heard it. */
const orders = new Map<string, "pending" | "paid">()

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ""

    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => resolve(body))
  })
}

/** Whether `signature` (Stripe's `t=…,v1=…` header) signs `body` with the webhook secret. */
function signed(body: string, signature: string): boolean {
  const parts = new Map(
    signature
      .split(",")
      .map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]),
  )
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${parts.get("t") ?? ""}.${body}`)
    .digest("hex")
  const given = parts.get("v1") ?? ""

  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  )
}

/** What each event says about its payment intent's status. */
const EVENTS: Record<string, (intent: string) => void> = {
  "payment_intent.succeeded": (intent) => orders.set(intent, "paid"),
  "payment_intent.created": (intent) => {
    if (trustsLatest || !orders.has(intent)) orders.set(intent, "pending")
  },
}

function text(res: ServerResponse, type: string, body: string): void {
  res.writeHead(200, { "content-type": type })
  res.end(body)
}

function page(res: ServerResponse, title: string, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>${title}</title><main><h1>${title}</h1>${body}</main>`)
}

/** A Checkout session for one lamp, as Stripe takes it. */
const LAMP = new URLSearchParams({
  mode: "payment",
  success_url: `${BASE}/done`,
  cancel_url: `${BASE}/`,
  "line_items[0][price_data][currency]": "usd",
  "line_items[0][price_data][unit_amount]": "4200",
  "line_items[0][price_data][product_data][name]": "Lamp",
  "line_items[0][quantity]": "1",
})

/** The new session's URL, or undefined when Stripe could not make one. */
async function checkoutUrl(): Promise<string | undefined> {
  const created = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "idempotency-key": crypto.randomUUID() },
    body: LAMP,
  }).catch(() => undefined)

  if (created?.ok !== true) return undefined

  return Session.safeParse(await created.json()).data?.url
}

/** Starts a Checkout session for a lamp and sends the customer to it. */
async function buy(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = await checkoutUrl()

  if (url === undefined) return page(res, "Try again later", "<p>Payments are down.</p>")

  res.writeHead(303, { location: url })
  res.end()
}

async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  const signature = req.headers["stripe-signature"]

  if (typeof signature !== "string" || !signed(body, signature)) {
    res.writeHead(400)
    res.end()

    return
  }

  const event = Event.parse(JSON.parse(body))

  EVENTS[event.type]?.(event.data.object.id)
  res.writeHead(200, { "content-type": "application/json" })
  res.end("{}")
}

/** The latest order's status, once Stripe told the shop about it. */
function latest(): string {
  return [...orders.values()].at(-1) ?? "unknown"
}

/** The status page; webhooks may land after it opens, so it asks again until they have. */
function done(_req: IncomingMessage, res: ServerResponse): void {
  page(
    res,
    "Your order",
    `<p role="status">Order ${latest()}</p>
    <script>setInterval(async () => {
      const status = await (await fetch("/status")).text();
      document.querySelector("[role=status]").textContent = "Order " + status;
    }, 200)</script>`,
  )
}

function home(_req: IncomingMessage, res: ServerResponse): void {
  const form = `<form method="post" action="/buy"><button type="submit">Buy a lamp</button></form>`

  page(res, "Lamp shop", form)
}

const ROUTES: Record<string, (req: IncomingMessage, res: ServerResponse) => unknown> = {
  "POST /buy": buy,
  "POST /webhooks/stripe": webhook,
  "GET /done": done,
  "GET /status": (_req, res) => text(res, "text/plain", latest()),
  "GET /orders.json": (_req, res) =>
    text(res, "application/json", JSON.stringify(Object.fromEntries(orders))),
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? "/", BASE).pathname

  const route = ROUTES[`${req.method} ${path}`] ?? home

  void Promise.resolve()
    .then(() => route(req, res))
    .catch(() => res.end())
}

createServer(handle).listen(Number(process.env["PORT"]), "127.0.0.1", () =>
  console.log("listening"),
)
