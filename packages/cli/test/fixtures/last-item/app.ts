/**
 * A shop with one lamp left in stock. Each visitor gets a buyer cookie; buying takes the lamp if
 * it is still there. The careful shop checks and takes in one step, so two buyers at once get one
 * lamp between them. `OVERSELL_BUG=1` reads the stock, waits as a slow database would, then writes
 * it back: two buyers (or one form sent twice) both see a lamp and both get an order.
 */
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { setTimeout as sleep } from "node:timers/promises"

const oversells = process.env.OVERSELL_BUG === "1"
/**
 * How long the oversell bug waits between reading and writing the stock. Two people's clicks can
 * land a second apart on a busy machine (the person whose trial keeps the record films and
 * screenshots each step, the other does not), and both must land inside the wait to oversell.
 */
const SLOW_DATABASE_MS = 1_500
let stock = 1
const orders: string[] = []

/** The buyer this browser is, from its cookie. */
function buyerOf(req: IncomingMessage): string | undefined {
  return /buyer=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1]
}

/** Takes the lamp for `buyer` if one is left; whether they got it. */
async function take(buyer: string): Promise<boolean> {
  if (!oversells) {
    if (stock < 1) return false
    stock -= 1
    orders.push(buyer)

    return true
  }

  const seen = stock

  await sleep(SLOW_DATABASE_MS)
  if (seen < 1) return false
  stock = seen - 1
  orders.push(buyer)

  return true
}

function page(res: ServerResponse, title: string, body: string, cookie?: string): void {
  res.writeHead(200, {
    "content-type": "text/html",
    ...(cookie !== undefined && { "set-cookie": cookie }),
  })
  res.end(`<!doctype html><title>${title}</title><main>${body}</main>`)
}

async function buy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const got = await take(buyerOf(req) ?? "anonymous")

  res.writeHead(303, { location: got ? "/thanks" : "/sold-out" })
  res.end()
}

function books(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ stock, orders: orders.length }))
}

/** The lamp's page; a first visit gets a buyer cookie. */
function home(req: IncomingMessage, res: ServerResponse): void {
  const cookie = buyerOf(req) === undefined ? `buyer=${randomUUID()}; Path=/` : undefined
  const form = `<form method="post" action="/buy"><button>Buy the lamp</button></form>`

  page(res, "Lamp", `<h1>Vintage lamp</h1><p>${stock} left</p>${form}`, cookie)
}

const ROUTES: Record<string, (req: IncomingMessage, res: ServerResponse) => unknown> = {
  "POST /buy": buy,
  "GET /stock.json": books,
  "GET /thanks": (_req, res) => page(res, "Thanks", "<h1>Thanks, the lamp is yours</h1>"),
  "GET /sold-out": (_req, res) => page(res, "Sold out", "<h1>Sorry, sold out</h1>"),
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? "/", "http://shop").pathname

  const route = ROUTES[`${req.method} ${path}`] ?? home

  void Promise.resolve()
    .then(() => route(req, res))
    .catch(() => res.end())
}

createServer(handle).listen(Number(process.env.PORT ?? 0), "127.0.0.1", () =>
  console.log("listening"),
)
