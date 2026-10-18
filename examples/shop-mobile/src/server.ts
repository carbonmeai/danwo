/**
 * The mobile shop's server, written the way an app's backend normally is: it creates Stripe
 * Checkout Sessions with the official client and knows nothing about danwo. Its books and webhook
 * are the web shop's. The app reaches it as `http://shop.danwo.test`.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PORT (0 picks one; it is printed as
 * `listening <port>`). SHOP_BUG=no-dedupe turns off webhook de-duplication, a bug to catch.
 * SHOP_TEST_RESET=1 adds `POST /__test/reset`, which empties the shop's books.
 */
import { createServer, type IncomingMessage } from "node:http"
import { text } from "node:stream/consumers"

import { Stripe } from "stripe"

import { credits, emptyBooks, handleWebhook } from "../../shop/src/webhooks.ts"

/** What one purchase buys, and its price in cents. */
const CREDITS = 500
const PRICE = 500

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "")
const testReset = process.env.SHOP_TEST_RESET === "1"

interface Answer {
  readonly status: number
  readonly body: unknown
}

/** A Checkout Session for 500 credits; Checkout returns to the app through its link scheme. */
async function checkout(user: string): Promise<Answer> {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: user,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `${CREDITS} credits` },
          unit_amount: PRICE,
        },
        quantity: 1,
      },
    ],
    metadata: { user, credits: String(CREDITS) },
    success_url: "danwoshop://done?session={CHECKOUT_SESSION_ID}",
    cancel_url: "danwoshop://cancel",
  })

  return { status: 200, body: { url: session.url } }
}

/** The answer to one request. */
async function answer(req: IncomingMessage): Promise<Answer> {
  const url = new URL(req.url ?? "/", "http://shop")
  const user = url.searchParams.get("user") ?? ""

  switch (`${req.method} ${url.pathname}`) {
    case "POST /checkout":
      return checkout(user)
    case "GET /credits":
      return { status: 200, body: { credits: credits.get(user) ?? 0 } }
    case "POST /webhooks/stripe":
      return handleWebhook(stripe, process.env.STRIPE_WEBHOOK_SECRET ?? "", {
        body: await text(req),
        signature: String(req.headers["stripe-signature"]),
      })
    case "POST /__test/reset":
      if (!testReset) break
      emptyBooks()

      return { status: 200, body: { reset: true } }
  }

  return { status: 404, body: { error: "not found" } }
}

const server = createServer((req, res) => {
  answer(req)
    .catch((error: unknown) => ({
      status: 502,
      body: { error: error instanceof Error ? error.message : "error" },
    }))
    .then(({ status, body }) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    })
    .catch(() => res.destroy())
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address()

  console.log(`listening ${typeof address === "object" && address ? address.port : ""}`)
})
