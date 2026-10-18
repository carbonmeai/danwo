/*
 * An app under test that sells 500 credits through Flutterwave Standard, written the way
 * Flutterwave documents it and knowing nothing about danwo: it creates a payment link with plain
 * fetch, and grants credits only after verifying the transaction by id (status, amount, currency and
 * tx_ref), whether it hears of the payment from the redirect or from a `charge.completed` webhook
 * carrying the right `verif-hash`. It says `ready <port>` once it listens.
 */
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const secretKey = process.env["FLW_SECRET_KEY"] ?? ""
const secretHash = process.env["FLW_SECRET_HASH"] ?? ""
const price = 7500

/** Orders by tx_ref, and whether each has been credited. */
const orders = new Map<string, { credited: boolean }>()
let credits = 0
let rejectedHooks = 0
let port = 0

async function flutterwave(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.flutterwave.com${path}`, {
    method,
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

  return response.json()
}

/** An object's fields; none for anything else. */
function fields(value: unknown): Map<string, unknown> {
  return typeof value === "object" && value !== null ? new Map(Object.entries(value)) : new Map()
}

/** Whether a transaction is a successful payment of the full price in NGN. */
function fullPayment(tx: Map<string, unknown>): boolean {
  return (
    tx.get("status") === "successful" &&
    tx.get("currency") === "NGN" &&
    Number(tx.get("amount")) >= price
  )
}

/** The verified transaction's tx_ref, when it pays one of this app's orders in full. */
async function verifiedPayment(id: string): Promise<string | undefined> {
  const answer = await flutterwave("GET", `/v3/transactions/${encodeURIComponent(id)}/verify`)
  const tx = fields(fields(answer).get("data"))
  const txRef = tx.get("tx_ref")

  return fullPayment(tx) && typeof txRef === "string" && orders.has(txRef) ? txRef : undefined
}

/** Credits an order once, however often its payment is reported. */
function credit(txRef: string): void {
  const order = orders.get(txRef)

  if (order === undefined || order.credited) return

  order.credited = true
  credits += 500
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = ""

  for await (const chunk of req) body += String(chunk)

  return body
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(value))
}

async function buy(res: ServerResponse): Promise<void> {
  const txRef = `order-${randomUUID()}`

  orders.set(txRef, { credited: false })

  const answer = await flutterwave("POST", "/v3/payments", {
    tx_ref: txRef,
    amount: price,
    currency: "NGN",
    redirect_url: `http://127.0.0.1:${port}/paid`,
    customer: { email: "ada@example.com", name: "Ada Lovelace" },
  })

  json(res, answer)
}

async function paid(url: URL, res: ServerResponse): Promise<void> {
  const id = url.searchParams.get("transaction_id")
  const txRef =
    url.searchParams.get("status") === "successful" && id ? await verifiedPayment(id) : undefined

  if (txRef) credit(txRef)
  json(res, { credited: txRef !== undefined, credits })
}

async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)

  if (req.headers["verif-hash"] !== secretHash) {
    rejectedHooks++
    res.writeHead(401).end()

    return
  }

  res.writeHead(200).end()

  const hook: unknown = JSON.parse(body)
  const data = typeof hook === "object" && hook !== null && "data" in hook ? hook.data : null
  const id = typeof data === "object" && data !== null && "id" in data ? String(data.id) : ""
  const txRef = await verifiedPayment(id)

  if (txRef) credit(txRef)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const routes: Record<string, () => Promise<void>> = {
    "GET /buy": () => buy(res),
    "GET /paid": () => paid(url, res),
    "POST /webhook": () => webhook(req, res),
    "GET /report": async () => json(res, { credits, rejectedHooks }),
  }
  const route = routes[`${req.method ?? "GET"} ${url.pathname}`]

  void (route ? route() : Promise.resolve(json(res, { error: "not found" }, 404)))
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()

  port = typeof address === "object" && address !== null ? address.port : 0
  console.log(`ready ${port}`)
})
