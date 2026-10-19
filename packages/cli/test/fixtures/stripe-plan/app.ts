/**
 * A small subscription app, written the way such apps are: the Pro plan is bought through
 * Stripe Checkout in subscription mode, and what the account page shows follows Stripe's signed
 * webhooks: the subscription's status, and one entry per paid invoice. It knows nothing about
 * danwo.
 *
 * Env: PORT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PRO_LOOKUP_KEY.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { Stripe } from "stripe"

const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"] ?? "")
const secret = process.env["STRIPE_WEBHOOK_SECRET"] ?? ""
const lookupKey = process.env["PRO_LOOKUP_KEY"] ?? ""
const base = `http://127.0.0.1:${process.env["PORT"]}`

const seenEvents = new Set<string>()
let status = "none"
const invoices: string[] = []

const page = (title: string, content: string) => `<!doctype html><title>${title}</title>
  <main><h1>${title}</h1>${content}</main>`

function account(): string {
  return page(
    "Your plan",
    `<p role="status">Plan: ${status}</p>
     <p data-testid="invoices">Invoices: ${invoices.length}</p>
     <ul>${invoices.map((reason) => `<li>${reason}</li>`).join("")}</ul>`,
  )
}

const home = () =>
  status === "none"
    ? page(
        "Pro plan",
        `<form method="post" action="/subscribe"><button type="submit">Subscribe to Pro</button></form>`,
      )
    : account()

/** Starts a subscription Checkout for the Pro price, found by its lookup key. */
async function subscribe(response: ServerResponse): Promise<void> {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey] })
  const price = data[0]

  if (!price) {
    response.writeHead(500).end("no Pro price")

    return
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    customer_email: "ada@danwo-plan.com",
    success_url: `${base}/account`,
    cancel_url: `${base}/`,
  })

  response.writeHead(303, { location: session.url ?? "/" }).end()
}

/** Follows the subscription from the events the app listens for, each event once. */
function apply(event: Stripe.Event): void {
  if (seenEvents.has(event.id)) return
  seenEvents.add(event.id)

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  )
    status = event.data.object.status
  if (event.type === "invoice.paid") invoices.push(event.data.object.billing_reason ?? "manual")
}

function webhook(raw: Buffer, request: IncomingMessage, response: ServerResponse): void {
  try {
    apply(stripe.webhooks.constructEvent(raw, String(request.headers["stripe-signature"]), secret))
    response.writeHead(200).end()
  } catch {
    response.writeHead(400).end()
  }
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []

  for await (const chunk of request) chunks.push(Buffer.from(chunk))

  return Buffer.concat(chunks)
}

/** Answers one request. */
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", base).pathname
  const html = (text: string) => response.writeHead(200, { "content-type": "text/html" }).end(text)

  if (request.method === "POST" && path === "/subscribe") return subscribe(response)
  if (request.method === "POST" && path === "/webhooks/stripe")
    return webhook(await body(request), request, response)

  if (path === "/state.json") {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ status, invoices }))

    return
  }

  html(path === "/account" ? account() : home())
}

createServer((request, response) => void handle(request, response)).listen(
  Number(process.env["PORT"]),
  "127.0.0.1",
  () => console.log("listening"),
)
