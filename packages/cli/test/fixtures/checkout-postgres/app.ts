/**
 * An app under test that sells lamps: POST /checkout charges the buyer through Stripe, then records
 * the order and takes a lamp from stock in one Postgres transaction. The buyer's checkout key
 * makes it safe to try again: Stripe gets it as the idempotency key, and the order is inserted at
 * most once per key, so a COMMIT whose reply was lost can be retried. Serialization failures,
 * deadlocks and lost connections are retried with backoff.
 *
 * `DANWO_BUG` switches in one mistake:
 * - `blind-insert`: the order is inserted without its key, so a retry after a COMMIT that did
 *   land records the order twice;
 * - `no-serialization-retry`: a serialization failure or deadlock is not retried; the buyer sees
 *   a 500 after being charged;
 * - `retry-request`: a failed save retries the whole request, charge included, without an
 *   idempotency key.
 */
import { createServer, type ServerResponse } from "node:http"

import { Pool } from "pg"
import { z } from "zod"

const BUG = process.env.DANWO_BUG ?? ""
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 2000,
})

/**
 * A restore or a dropped line closes connections, idle or in use; the pool opens new ones, and
 * the query on a dropped one fails and is retried.
 */
pool.on("error", () => undefined)
pool.on("connect", (client) => client.on("error", () => undefined))

const PaymentIntent = z.object({ id: z.string() })

/** Errors that say nothing was decided: another attempt may succeed. */
const CONCURRENCY = new Set(["40001", "40P01"])
/** The database is full or going away: a new connection may succeed. */
const UNAVAILABLE = new Set(["53300", "57P01"])

function sqlstate(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

/** Whether another attempt may succeed: a SQLSTATE says so, or the line was lost (no SQLSTATE). */
function retryable(error: unknown): boolean {
  const code = sqlstate(error) ?? "lost"

  if (CONCURRENCY.has(code)) return BUG !== "no-serialization-retry"

  return !/^\d/.test(code) || UNAVAILABLE.has(code)
}

const worthAnother = (error: unknown, deadline: number) =>
  Date.now() <= deadline && retryable(error)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs `work` until it succeeds, retrying what `retryable` allows for up to eight seconds. */
async function retrying<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 8000

  for (let attempt = 0; ; attempt++) {
    const outcome = await work().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )

    if ("value" in outcome) return outcome.value
    if (!worthAnother(outcome.error, deadline)) throw outcome.error
    await sleep(Math.min(1000, 100 * 2 ** attempt))
  }
}

async function charge(key: string): Promise<string> {
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: "Bearer sk_test_danwo_checkout",
      "content-type": "application/x-www-form-urlencoded",
      ...(BUG !== "retry-request" && { "idempotency-key": key }),
    },
    body: "amount=4900&currency=usd",
  })

  if (!response.ok) throw new Error(`stripe answered ${response.status}`)

  return PaymentIntent.parse(await response.json()).id
}

/** Records the order and takes a lamp from stock, once per checkout key. */
async function saveOrder(key: string, intent: string): Promise<void> {
  const client = await pool.connect()
  let broken = false

  try {
    await client.query("BEGIN")

    const inserted =
      BUG === "blind-insert"
        ? await client.query("INSERT INTO orders (payment_intent) VALUES ($1) RETURNING id", [
            intent,
          ])
        : await client.query(
            "INSERT INTO orders (checkout_key, payment_intent) VALUES ($1, $2) ON CONFLICT (checkout_key) DO NOTHING RETURNING id",
            [key, intent],
          )

    if (inserted.rowCount === 1)
      await client.query("UPDATE stock SET left_count = left_count - 1 WHERE item = 'lamp'")
    await client.query("COMMIT")
  } catch (error) {
    broken = !(await client.query("ROLLBACK").then(
      () => true,
      () => false,
    ))
    throw error
  } finally {
    client.release(broken)
  }
}

async function checkout(key: string, res: ServerResponse): Promise<void> {
  if (BUG === "retry-request") await retrying(async () => saveOrder(key, await charge(key)))
  else {
    const intent = await charge(key)

    await retrying(() => saveOrder(key, intent))
  }

  res.writeHead(201).end()
}

async function state(res: ServerResponse): Promise<void> {
  const result = await pool.query<{ orders: number; stock: number }>(
    "SELECT (SELECT count(*) FROM orders)::int AS orders, (SELECT left_count FROM stock WHERE item = 'lamp') AS stock",
  )

  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result.rows[0]))
}

/** POST /checkout buys a lamp; GET /state shows the orders and the stock left. */
const server = createServer((req, res) => {
  const key = String(req.headers["checkout-key"] ?? "")
  const work = req.method === "POST" ? checkout(key, res) : state(res)

  work.catch((error: unknown) => res.writeHead(500).end(String(error)))
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address()

  if (address !== null && typeof address === "object") console.log(`listening ${address.port}`)
})
