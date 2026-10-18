/*
 * An app under test that takes orders: it creates a Stripe payment intent, then saves the order
 * in Postgres. It knows nothing about danwo: Stripe is reached through the proxy, and its pool
 * reconnects when a restore closes its connections.
 */
import { createServer, type ServerResponse } from "node:http"

import { Pool } from "pg"
import { z } from "zod"

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })

// A restore closes the pool's idle connections; the pool drops them and opens new ones.
pool.on("error", () => {})

const PaymentIntent = z.object({ id: z.string() })

async function order(res: ServerResponse): Promise<void> {
  const stripe = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: "Bearer sk_test_danwo_orders",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "amount=500&currency=usd",
  }).catch(() => undefined)

  if (!stripe?.ok) {
    res.writeHead(502).end()

    return
  }

  const intent = PaymentIntent.parse(await stripe.json())

  await pool.query("INSERT INTO orders (payment_intent) VALUES ($1)", [intent.id])
  res.writeHead(201).end()
}

async function count(res: ServerResponse): Promise<void> {
  const result = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM orders")

  res
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ orders: result.rows[0]?.n ?? 0 }))
}

// POST /orders places an order; GET /orders counts the saved ones.
const server = createServer((req, res) => {
  const work = req.method === "POST" ? order(res) : count(res)

  work.catch((error: unknown) => res.writeHead(500).end(String(error)))
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address()

  if (address !== null && typeof address === "object") console.log(`listening ${address.port}`)
})
