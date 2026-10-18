/*
 * A small app that sells 500 credits through Flutterwave Standard, written the way Flutterwave
 * documents it: it creates a payment link on api.flutterwave.com and sends the customer to the hosted
 * page. Credits are given only from a `charge.completed` webhook whose `verif-hash` matches and
 * whose transaction verifies by id as a successful payment of the price in NGN, once per tx_ref.
 * It knows nothing about danwo.
 *
 * Env: PORT, FLW_SECRET_KEY, FLW_SECRET_HASH. FLW_BUG=no-dedupe credits every verified webhook, so
 * a webhook Flutterwave sends twice is credited twice: a bug to catch.
 */
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const secretKey = process.env["FLW_SECRET_KEY"] ?? ""
const secretHash = process.env["FLW_SECRET_HASH"] ?? ""
const base = `http://127.0.0.1:${process.env["PORT"]}`
const dedupe = process.env["FLW_BUG"] !== "no-dedupe"
const price = 7500

const orders = new Set<string>()
const credited = new Set<string>()
let credits = 0

const page = (title: string, body = "") => `<!doctype html><title>${title}</title>
  <main><h1>${title}</h1>${body}<p role="status">Credits: ${credits}</p></main>`

const home = () =>
  page(
    "Credits",
    `<form method="post" action="/buy"><button type="submit">Buy 500 credits</button></form>`,
  )

async function flutterwave(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.flutterwave.com${path}`, {
    method,
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

  return response.json()
}

/** The fields of an object, or none for anything else. */
function fieldsOf(value: unknown): Map<string, unknown> {
  if (typeof value !== "object" || value === null) return new Map()

  return new Map(Object.entries(value))
}

/** `data` of a Flutterwave answer, as a map of its fields. */
function dataOf(answer: unknown): Map<string, unknown> {
  return fieldsOf(fieldsOf(answer).get("data"))
}

function html(res: ServerResponse, markup: string): void {
  res.writeHead(200, { "content-type": "text/html" })
  res.end(markup)
}

/** Creates a payment link and sends the customer to it, or shows that it failed. */
async function buy(res: ServerResponse): Promise<void> {
  const txRef = `credits-${randomUUID()}`

  orders.add(txRef)

  const answer = await flutterwave("POST", "/v3/payments", {
    tx_ref: txRef,
    amount: price,
    currency: "NGN",
    redirect_url: `${base}/paid`,
    customer: { email: "ada@example.com", name: "Ada Lovelace" },
    customizations: { title: "500 credits" },
  }).catch(() => null)
  const link = dataOf(answer).get("link")

  if (typeof link === "string") res.writeHead(303, { location: link }).end()
  else
    html(res, page("Something went wrong", `<p role="alert">We could not start the payment.</p>`))
}

/** Whether a verified transaction is a successful payment of the full price in NGN. */
function paidInFull(tx: Map<string, unknown>): boolean {
  return (
    tx.get("status") === "successful" &&
    tx.get("currency") === "NGN" &&
    Number(tx.get("amount")) >= price
  )
}

/** The tx_ref of a transaction that verifies as a payment of one of this app's orders. */
async function verifiedOrder(id: string): Promise<string | undefined> {
  const path = `/v3/transactions/${encodeURIComponent(id)}/verify`
  const tx = dataOf(await flutterwave("GET", path).catch(() => null))
  const txRef = tx.get("tx_ref")

  return paidInFull(tx) && typeof txRef === "string" && orders.has(txRef) ? txRef : undefined
}

/** The transaction id a webhook names. */
function webhookId(body: string): string {
  const id = dataOf(JSON.parse(body)).get("id")

  return typeof id === "number" || typeof id === "string" ? String(id) : ""
}

/** Credits `txRef`, once unless the bug is on. */
function credit(txRef: string): void {
  if (dedupe && credited.has(txRef)) return

  credited.add(txRef)
  credits += 500
}

async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = ""

  for await (const chunk of req) body += String(chunk)

  if (req.headers["verif-hash"] !== secretHash) {
    res.writeHead(401).end()

    return
  }

  const txRef = await verifiedOrder(webhookId(body))

  if (txRef !== undefined) credit(txRef)

  res.writeHead(200).end()
}

/** The page after Flutterwave sends the customer back. */
function paidPage(url: URL): string {
  const received = url.searchParams.get("status") === "successful"

  return page(received ? "Payment received" : "Payment not completed")
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", base)
  const routes: Record<string, () => unknown> = {
    "POST /buy": () => buy(res),
    "POST /webhook": () => webhook(req, res),
    "GET /paid": () => html(res, paidPage(url)),
    "GET /credits.json": () => res.writeHead(200).end(JSON.stringify({ credits })),
  }
  const route = routes[`${req.method ?? "GET"} ${url.pathname}`] ?? (() => html(res, home()))

  void Promise.resolve(route())
})

server.listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
