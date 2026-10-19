/**
 * A small subscription app, written the way such apps are: a 14-day free trial of the Pro plan
 * through Bachs's hosted checkout, then monthly billing. What the customer may use follows the
 * subscription's status as the signed Bachs webhooks report it, and every paid invoice sends one
 * receipt. It knows nothing about danwo.
 *
 * Env: PORT, BACHS_API_KEY, BACHS_WEBHOOK_SECRET, PRO_PRODUCT. TRIAL_BUG=forever keeps access
 * once granted, even after the subscription stops being paid for; TRIAL_BUG=no-dedupe sends a
 * receipt for every delivery of `invoice.paid`, so one sent twice sends two receipts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { Bachs, webhooks } from "@bachs/sdk"

const bachs = new Bachs({ apiKey: process.env["BACHS_API_KEY"], environment: "sandbox" })
const secret = process.env["BACHS_WEBHOOK_SECRET"] ?? ""
const product = process.env["PRO_PRODUCT"] ?? ""
const base = `http://127.0.0.1:${process.env["PORT"]}`
const bug = process.env["TRIAL_BUG"]

/** Statuses a customer may use the product in. */
const PAID_UP = new Set(["trialing", "active"])

const seenEvents = new Set<string>()
let status = "none"
let everHadAccess = false
let receipts = 0

function access(): boolean {
  return PAID_UP.has(status) || (bug === "forever" && everHadAccess)
}

const page = (title: string, body: string) => `<!doctype html><title>${title}</title>
  <main><h1>${title}</h1>${body}</main>`

function account(): string {
  return page(
    "Your plan",
    `<p role="status">Plan: ${status}</p>
     <p data-testid="access">Access: ${access() ? "granted" : "revoked"}</p>
     <p data-testid="receipts">Receipts: ${receipts}</p>`,
  )
}

const home = () =>
  status === "none"
    ? page(
        "Pro plan",
        `<form method="post" action="/trial"><button type="submit">Start 14-day trial</button></form>`,
      )
    : account()

/** Starts the Pro trial's checkout and sends the customer to Bachs's hosted page. */
async function startTrial(response: ServerResponse): Promise<void> {
  try {
    const checkout = await bachs.checkoutSessions.create(
      {
        product_cart: [{ product_id: product, quantity: 1 }],
        customer: { email: "ada@danwo-shop.com", name: "Ada" },
        success_url: `${base}/account`,
        cancel_url: `${base}/`,
      },
      { idempotencyKey: "trial-ada" },
    )

    response.writeHead(303, { location: checkout.checkout_url }).end()
  } catch {
    response
      .writeHead(502, { "content-type": "text/html" })
      .end(page("Something went wrong", `<p role="alert">We could not start your trial.</p>`))
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

/** A field of an event's data, as text. */
function field(data: unknown, name: string): string {
  const value: unknown = typeof data === "object" && data !== null ? Reflect.get(data, name) : ""

  return typeof value === "string" ? value : ""
}

/** What each event the app listens for changes. */
const handlers: Record<string, ((data: unknown) => void) | undefined> = {
  "customer.subscription.created": (data) => (status = field(data, "status")),
  "customer.subscription.updated": (data) => (status = field(data, "status")),
  "customer.subscription.deleted": () => (status = "canceled"),
  "invoice.paid": (data) => {
    if (Number(field(data, "total")) > 0) receipts += 1
  },
}

/** Whether to act on an event: the first delivery of it (any delivery, with the bug). */
function firstSeen(id: string): boolean {
  const fresh = !seenEvents.has(id)

  seenEvents.add(id)

  return fresh || bug === "no-dedupe"
}

/** Follows the subscription and sends receipts, each event once (unless the bug says otherwise). */
function apply(event: { readonly id: string; readonly type: string; readonly data: unknown }) {
  if (!firstSeen(event.id)) return
  handlers[event.type]?.(event.data)
  everHadAccess ||= PAID_UP.has(status)
}

function webhook(raw: Buffer, request: IncomingMessage, response: ServerResponse): void {
  const event = verified(raw, request)

  if (!event) {
    response.writeHead(400).end()

    return
  }

  apply(event)
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
  "POST /trial": (_raw, _request, response) => startTrial(response),
  "POST /webhooks/bachs": webhook,
  "GET /state.json": (_raw, _request, response) =>
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ status, access: access(), receipts })),
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
        .end(path === "/account" ? account() : home())
  })()
})

server.listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
