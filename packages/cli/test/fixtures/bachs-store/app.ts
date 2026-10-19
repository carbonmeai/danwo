/*
 * A small app that sells credits through Bachs's hosted checkout, written the way such apps are: the
 * official Bachs SDK on its sandbox host. Buying sends the customer to the checkout; the credits are
 * granted only by the signed `collection.succeeded` webhook, deduplicated by event id. It knows
 * nothing about danwo.
 *
 * Env: PORT, BACHS_API_KEY, BACHS_WEBHOOK_SECRET. BACHS_BUG=no-dedupe grants credits for every
 * delivery it gets, so an event Bachs sends twice grants twice: a bug to catch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { Bachs, webhooks } from "@bachs/sdk"

const bachs = new Bachs({ apiKey: process.env["BACHS_API_KEY"], environment: "sandbox" })
const secret = process.env["BACHS_WEBHOOK_SECRET"] ?? ""
const base = `http://127.0.0.1:${process.env["PORT"]}`
const dedupe = process.env["BACHS_BUG"] !== "no-dedupe"
const CREDITS_PER_PACK = 500

const seenEvents = new Set<string>()
let credits = 0
let orders = 0

const page = (title: string, body = "") => `<!doctype html><title>${title}</title>
  <main><h1>${title}</h1>${body}<p role="status">Credits: ${credits}</p></main>`

const home = () =>
  page(
    "Credit store",
    `<form method="post" action="/buy"><button type="submit">Buy 500 credits</button></form>`,
  )

/** Starts a checkout for one pack and sends the customer to Bachs's hosted page. */
async function buy(response: ServerResponse): Promise<void> {
  try {
    orders += 1

    const checkout = await bachs.checkoutSessions.create(
      {
        pricing: { currency: "USD", amount: "5.00" },
        customer: { email: "ada@danwo-shop.com", name: "Ada" },
        reference: `order_${orders}`,
        success_url: `${base}/done`,
        cancel_url: `${base}/`,
      },
      { idempotencyKey: `checkout-order_${orders}` },
    )

    response.writeHead(303, { location: checkout.checkout_url }).end()
  } catch {
    response
      .writeHead(502, { "content-type": "text/html" })
      .end(page("Something went wrong", `<p role="alert">We could not start the checkout.</p>`))
  }
}

/** The delivery's event when its signature checks out; null when it does not. */
function verified(raw: Buffer, request: IncomingMessage) {
  try {
    return webhooks.constructEvent(raw, request.headers, secret)
  } catch {
    return null
  }
}

/** Whether an event grants a pack: a collected payment, counted once per event id. */
function grants(event: { readonly id: string; readonly type: string }): boolean {
  const fresh = !seenEvents.has(event.id)

  seenEvents.add(event.id)

  return event.type === "collection.succeeded" && (fresh || !dedupe)
}

/** Grants credits for a verified `collection.succeeded`; answers 400 to a delivery it cannot verify. */
function webhook(raw: Buffer, request: IncomingMessage, response: ServerResponse): void {
  const event = verified(raw, request)

  if (!event) {
    response.writeHead(400).end()

    return
  }

  if (grants(event)) credits += CREDITS_PER_PACK
  response.writeHead(200).end()
}

function read(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []

    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks)))
  })
}

type Route = (raw: Buffer, request: IncomingMessage, response: ServerResponse) => unknown

const routes: Record<string, Route | undefined> = {
  "POST /buy": (_raw, _request, response) => buy(response),
  "POST /webhooks/bachs": webhook,
}

const server = createServer((request, response) => {
  void (async () => {
    const raw = await read(request)
    const path = new URL(request.url ?? "/", base).pathname
    const route = routes[`${request.method} ${path}`]

    if (route) await route(raw, request, response)
    else
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(path === "/done" ? page("Thanks for your order") : home())
  })()
})

server.listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
