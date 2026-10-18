/*
 * A small app that sells credits through Stripe Checkout, written the way an app normally would:
 * it talks to api.stripe.com with the official client and knows nothing about danwo.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PORT (0 picks one; the chosen port is printed as
 * `listening <port>`). SHOP_BUG=no-dedupe turns off webhook de-duplication, a bug to catch.
 * SHOP_TEST_RESET=1 adds `POST /__test/reset`, which empties the shop's books: the in-memory
 * counterpart of restoring a template database, so a test environment can start each run afresh
 * without restarting the app.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { text as readText } from "node:stream/consumers"

import { Stripe } from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "")
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ""
const dedupe = process.env.SHOP_BUG !== "no-dedupe"

const credits = new Map<string, number>()
const handledEvents = new Set<string>()

async function readBody(req: IncomingMessage): Promise<string> {
  return readText(req)
}

/** The user and amount of a JSON purchase body. */
function purchaseOf(value: unknown): { user: string; amount: number } {
  const object = typeof value === "object" && value !== null ? value : {}
  const user = "user" in object && typeof object.user === "string" ? object.user : ""
  const amount = "amount" in object ? Number(object.amount) : Number.NaN

  return { user, amount }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function html(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" })
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`,
  )
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** The purchase as JSON (`{ user, amount }`) or from the home page's form (`user=...&amount=...`). */
async function readPurchase(
  req: IncomingMessage,
): Promise<{ user: string; amount: number; form: boolean }> {
  const body = await readBody(req)

  if (String(req.headers["content-type"]).includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body)

    return { user: params.get("user") ?? "", amount: Number(params.get("amount")), form: true }
  }

  return { ...purchaseOf(JSON.parse(body)), form: false }
}

async function buy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { user, amount, form } = await readPurchase(req)
  const origin = `http://${req.headers.host ?? "127.0.0.1"}`

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `${amount} credits` },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: { user, credits: String(amount) },
      success_url: form
        ? `${origin}/done?user=${encodeURIComponent(user)}&session={CHECKOUT_SESSION_ID}`
        : "https://shop.test/done?session={CHECKOUT_SESSION_ID}",
    })

    if (form) {
      res.writeHead(303, { location: session.url ?? "/" })
      res.end()

      return
    }

    send(res, 200, { url: session.url })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe error"

    if (form)
      html(
        res,
        502,
        "Checkout unavailable",
        `<h1>Checkout unavailable</h1><p role="alert">${escapeHtml(message)}</p>`,
      )
    else send(res, 502, { error: message })
  }
}

function home(res: ServerResponse): void {
  html(
    res,
    200,
    "Shop",
    `<h1>Credits shop</h1>
<form method="post" action="/buy">
  <input type="hidden" name="user" value="u1">
  <input type="hidden" name="amount" value="500">
  <button type="submit">Buy 500 credits</button>
</form>`,
  )
}

/** The page Stripe Checkout returns to. Credits arrive by webhook, so it polls until they show. */
function done(res: ServerResponse, user: string): void {
  const balance = credits.get(user) ?? 0

  html(
    res,
    200,
    "Thank you",
    `<h1>Thank you for your purchase</h1>
<p id="credits">Credits: ${balance}</p>
<script>
  const user = ${JSON.stringify(user)};
  setInterval(async () => {
    const res = await fetch("/credits?user=" + encodeURIComponent(user));
    const { credits } = await res.json();
    document.getElementById("credits").textContent = "Credits: " + credits;
  }, 250);
</script>`,
  )
}

/** The verified event in a webhook request, or undefined if its signature doesn't check out. */
function verifiedEvent(body: string, signature: string): Stripe.Event | undefined {
  try {
    return stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return undefined
  }
}

/** Grants a completed checkout's credits; returns false if the event was already handled. */
function grantCredits(event: Stripe.CheckoutSessionCompletedEvent): boolean {
  if (dedupe && handledEvents.has(event.id)) return false

  handledEvents.add(event.id)

  const session = event.data.object
  const user = session.metadata?.user ?? ""

  credits.set(user, (credits.get(user) ?? 0) + Number(session.metadata?.credits ?? 0))

  return true
}

async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const event = verifiedEvent(await readBody(req), String(req.headers["stripe-signature"]))

  if (!event) return send(res, 400, { error: "bad signature" })
  if (event.type === "checkout.session.completed" && !grantCredits(event))
    return send(res, 200, { duplicate: true })

  send(res, 200, { received: true })
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => unknown

const ROUTES: Record<string, Route> = {
  "GET /": (_req, res) => home(res),
  "GET /done": (_req, res, url) => done(res, url.searchParams.get("user") ?? ""),
  "POST /buy": (req, res) => buy(req, res),
  "POST /webhooks/stripe": (req, res) => webhook(req, res),
  "GET /credits": (_req, res, url) =>
    send(res, 200, { credits: credits.get(url.searchParams.get("user") ?? "") ?? 0 }),
  ...(process.env.SHOP_TEST_RESET === "1" && { "POST /__test/reset": emptyBooks }),
}

/** Forgets every credit and handled event. */
function emptyBooks(_req: IncomingMessage, res: ServerResponse): void {
  credits.clear()
  handledEvents.clear()
  send(res, 200, { reset: true })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://shop")
  const route = ROUTES[`${req.method} ${url.pathname}`]
  const handled = route ? route(req, res, url) : send(res, 404, { error: "not found" })

  Promise.resolve(handled).catch((error: unknown) => {
    send(res, 500, { error: error instanceof Error ? error.message : "error" })
  })
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address()

  console.log(`listening ${typeof address === "object" && address ? address.port : ""}`)
})
