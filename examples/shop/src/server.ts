/*
 * A small app that sells credits through Stripe Checkout, written the way an app normally would:
 * it talks to api.stripe.com with the official client and knows nothing about danwo.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PORT (0 picks one; the chosen port is printed as
 * `listening <port>`). SHOP_BUG=no-dedupe turns off webhook de-duplication, a bug to catch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "")
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ""
const dedupe = process.env.SHOP_BUG !== "no-dedupe"

const credits = new Map<string, number>()
const handledEvents = new Set<string>()

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))

  return Buffer.concat(chunks).toString("utf8")
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

  const { user, amount } = JSON.parse(body) as { user: string; amount: number }

  return { user, amount, form: false }
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

async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      String(req.headers["stripe-signature"]),
      webhookSecret,
    )
  } catch {
    send(res, 400, { error: "bad signature" })

    return
  }

  if (event.type === "checkout.session.completed") {
    if (dedupe && handledEvents.has(event.id)) {
      send(res, 200, { duplicate: true })

      return
    }

    handledEvents.add(event.id)
    const session = event.data.object
    const user = session.metadata?.user ?? ""

    credits.set(user, (credits.get(user) ?? 0) + Number(session.metadata?.credits ?? 0))
  }

  send(res, 200, { received: true })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://shop")
  const route = `${req.method} ${url.pathname}`
  const handled =
    route === "GET /"
      ? Promise.resolve(home(res))
      : route === "GET /done"
        ? Promise.resolve(done(res, url.searchParams.get("user") ?? ""))
        : route === "POST /buy"
          ? buy(req, res)
          : route === "POST /webhooks/stripe"
            ? webhook(req, res)
            : route === "GET /credits"
              ? Promise.resolve(
                  send(res, 200, { credits: credits.get(url.searchParams.get("user") ?? "") ?? 0 }),
                )
              : Promise.resolve(send(res, 404, { error: "not found" }))

  handled.catch((error: unknown) => {
    send(res, 500, { error: error instanceof Error ? error.message : "error" })
  })
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address()

  console.log(`listening ${typeof address === "object" && address ? address.port : ""}`)
})
