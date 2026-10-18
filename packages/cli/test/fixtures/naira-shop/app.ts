/*
 * A small shop that sells credits in naira through Paystack, written the way such apps are: plain
 * fetch to Paystack's real host, the customer sent to Paystack's hosted page, and credits granted
 * by the `charge.success` webhook once its signature checks out. The return to `/callback` only
 * verifies and says how the payment went. It knows nothing about danwo.
 *
 * Env: PORT, PAYSTACK_SECRET_KEY. PAYSTACK_BUG=no-dedupe grants credits for every
 * `charge.success` it gets, so an event Paystack sends twice pays out twice: a bug to catch.
 */
import { createHmac } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { z } from "zod"

const SECRET = process.env["PAYSTACK_SECRET_KEY"] ?? ""
const BASE = `http://127.0.0.1:${process.env["PORT"]}`
const DEDUPE = process.env["PAYSTACK_BUG"] !== "no-dedupe"
const CREDITS_PER_PACK = 500

const Started = z.object({ data: z.object({ authorization_url: z.string() }) })
const Verified = z.object({ data: z.object({ status: z.string() }) })
const ChargeEvent = z.object({
  event: z.string(),
  data: z.object({ reference: z.string() }).loose(),
})

const granted = new Set<string>()
let credits = 0

const page = (title: string, body = "") => `<!doctype html><title>${title}</title>
  <main><h1>${title}</h1>${body}<p role="status">Credits: ${credits}</p></main>`

const home = () =>
  page(
    "Naira Shop",
    `<form method="post" action="/buy"><button type="submit">Buy 500 credits</button></form>`,
  )

async function paystack(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
  })

  if (!response.ok) throw new Error(`Paystack answered ${response.status}`)

  return response.json()
}

/** Starts a payment and sends the customer to Paystack's page for it. */
async function buy(res: ServerResponse): Promise<void> {
  try {
    const started = Started.parse(
      await paystack("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: "ada@naira.test",
          amount: 500_000,
          callback_url: `${BASE}/callback`,
        }),
      }),
    )

    res.writeHead(303, { location: started.data.authorization_url }).end()
  } catch {
    res.end(page("Something went wrong", '<p role="alert">We could not start the payment.</p>'))
  }
}

/** Where Paystack's page sends the customer back: verify, and say how it went. */
async function callback(url: URL, res: ServerResponse): Promise<void> {
  try {
    const reference = url.searchParams.get("reference") ?? ""
    const verified = Verified.parse(await paystack(`/transaction/verify/${reference}`))

    res.end(page(verified.data.status === "success" ? "Payment confirmed" : "Payment pending"))
  } catch {
    res.end(page("Payment pending", '<p role="alert">We could not check the payment yet.</p>'))
  }
}

/** Whether a `charge.success` grants a pack: once per reference, unless the bug is on. */
function grants(event: z.infer<typeof ChargeEvent>): boolean {
  return event.event === "charge.success" && !(DEDUPE && granted.has(event.data.reference))
}

/** A Paystack event: refused unless its signature is Paystack's; a payment grants a pack. */
function webhook(req: IncomingMessage, body: string, res: ServerResponse): void {
  const expected = createHmac("sha512", SECRET).update(body).digest("hex")

  if (req.headers["x-paystack-signature"] !== expected) return void res.writeHead(401).end()

  const parsed = ChargeEvent.safeParse(JSON.parse(body))

  if (parsed.success && grants(parsed.data)) {
    granted.add(parsed.data.data.reference)
    credits += CREDITS_PER_PACK
  }

  res.end()
}

type Route = (req: IncomingMessage, url: URL, body: string, res: ServerResponse) => void

/** The app's routes by method and path; anything else shows the shop. */
const ROUTES: Readonly<Record<string, Route>> = {
  "POST /buy": (_req, _url, _body, res) => void buy(res),
  "GET /callback": (_req, url, _body, res) => void callback(url, res),
  "POST /paystack/webhook": (req, _url, body, res) => webhook(req, body, res),
}

createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    const url = new URL(req.url ?? "/", BASE)
    const route = ROUTES[`${req.method ?? "GET"} ${url.pathname}`]

    res.setHeader("content-type", "text/html; charset=utf-8")
    if (route) route(req, url, body, res)
    else res.end(home())
  })
}).listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
