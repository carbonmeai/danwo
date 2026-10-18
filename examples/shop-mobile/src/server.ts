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
import type { AddressInfo } from "node:net"
import { text } from "node:stream/consumers"

import { Stripe } from "stripe"

import { credits, emptyBooks, handleWebhook } from "../../shop/src/webhooks.ts"

/** What one purchase buys, and its price in cents. */
const CREDITS = 500
const PRICE = 500

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "")

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

type Handler = (req: IncomingMessage, user: string) => Answer | Promise<Answer>

/** What the server answers, by method and path. */
const HANDLERS = new Map<string, Handler>([
  ["POST /checkout", (_req, user) => checkout(user)],
  ["GET /credits", (_req, user) => ({ status: 200, body: { credits: credits.get(user) ?? 0 } })],
  [
    "POST /webhooks/stripe",
    async (req) =>
      handleWebhook(stripe, process.env.STRIPE_WEBHOOK_SECRET ?? "", {
        body: await text(req),
        signature: String(req.headers["stripe-signature"]),
      }),
  ],
])

if (process.env.SHOP_TEST_RESET === "1") {
  HANDLERS.set("POST /__test/reset", () => {
    emptyBooks()

    return { status: 200, body: { reset: true } }
  })
}

const notFound: Handler = () => ({ status: 404, body: { error: "not found" } })

/** A failure on the way (Stripe unreachable) as a 502. */
function failed(error: unknown): Answer {
  return { status: 502, body: { error: error instanceof Error ? error.message : "error" } }
}

/** The answer to one request. */
async function answer(req: IncomingMessage): Promise<Answer> {
  const url = new URL(req.url ?? "/", "http://shop")
  const handler = HANDLERS.get(`${req.method} ${url.pathname}`) ?? notFound

  return Promise.resolve(url.searchParams.get("user") ?? "")
    .then((user) => handler(req, user))
    .catch(failed)
}

const server = createServer(async (req, res) => {
  const { status, body } = await answer(req)

  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo

  process.stdout.write(`listening ${port}\n`)
})
