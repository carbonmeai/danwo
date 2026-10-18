/*
 * A shop written carelessly, the way integration lint is there to catch: it creates Checkout
 * sessions with plain fetch and no Idempotency-Key, its page looks up the customer with the
 * secret key in the URL, and it grants credits as soon as Stripe redirects back, without a
 * webhook or a check that the payment happened. Every page still works.
 *
 * Env: PORT, STRIPE_SECRET_KEY.
 */
import { createServer, type ServerResponse } from "node:http"

import { z } from "zod"

const SECRET = process.env["STRIPE_SECRET_KEY"] ?? ""
const BASE = `http://127.0.0.1:${process.env["PORT"]}`
const Session = z.object({ url: z.string() })

let credits = 0

function page(res: ServerResponse, title: string, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>${title}</title><main><h1>${title}</h1>${body}
    <p role="status">Credits: ${credits}</p></main>`)
}

/** The home page; its script reads the customer straight from Stripe, key and all. */
function home(res: ServerResponse): void {
  page(
    res,
    "Sloppy Shop",
    `<form method="post" action="/buy"><button type="submit">Buy 500 credits</button></form>
    <script>fetch("https://api.stripe.com/v1/customers?limit=1&key=${SECRET}").catch(() => {})</script>`,
  )
}

/** Starts a Checkout session with no Idempotency-Key and sends the customer to it. */
async function buy(res: ServerResponse): Promise<void> {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: `${BASE}/thanks`,
    cancel_url: `${BASE}/`,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "500 credits",
    "line_items[0][price_data][unit_amount]": "500",
    "line_items[0][quantity]": "1",
  })
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })
  const session = Session.parse(await response.json())

  res.writeHead(303, { location: session.url })
  res.end()
}

/** Trusts the redirect: anyone who opens this page gets the credits. */
function thanks(res: ServerResponse): void {
  credits += 500
  page(res, "Thank you for your purchase", "")
}

/** The shop's pages, by method and path. */
const ROUTES: Readonly<Record<string, (res: ServerResponse) => void>> = {
  "GET /": home,
  "GET /thanks": thanks,
  "POST /buy": (res) => void buy(res).catch(() => page(res, "Payment failed", "")),
}

const server = createServer((req, res) => {
  const route = ROUTES[`${req.method} ${(req.url ?? "/").split("?")[0]}`]

  if (route !== undefined) return route(res)

  res.writeHead(404)
  res.end()
})

server.listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
