/*
 * An app under test that knows nothing about the proxy: it calls Paystack's real host with plain
 * fetch, as many integrations do. On a "start" line on stdin it initializes a transaction and
 * prints the payment link; the customer's browser comes back to `/callback`, where it verifies the
 * payment; `/webhook` checks Paystack's signature before trusting an event. Each step prints JSON.
 */
import { createHmac } from "node:crypto"
import { createServer } from "node:http"
import { createInterface } from "node:readline"

const SECRET = process.env.PAYSTACK_SECRET_KEY ?? ""
const PORT = Number(process.env.PORT)

function print(value: object): void {
  console.log(JSON.stringify(value))
}

async function paystack(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
  })

  return response.json()
}

function dataOf(body: unknown): Record<string, unknown> {
  const data = typeof body === "object" && body !== null && "data" in body ? body.data : undefined

  return typeof data === "object" && data !== null ? Object.fromEntries(Object.entries(data)) : {}
}

const server = createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)

    if (url.pathname === "/webhook") {
      const expected = createHmac("sha512", SECRET).update(body).digest("hex")
      const event = String(dataOf({ data: JSON.parse(body) })["event"])

      print({ event, valid: req.headers["x-paystack-signature"] === expected })
      res.end()

      return
    }

    void paystack(`/transaction/verify/${url.searchParams.get("reference") ?? ""}`).then(
      (answer) => {
        print({ verified: dataOf(answer)["status"] })
        res.end("thanks")
      },
    )
  })
})

server.listen(PORT, "127.0.0.1", () => print({ ready: true }))

for await (const line of createInterface({ input: process.stdin })) {
  if (line !== "start") continue

  const started = dataOf(
    await paystack("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: "ada@shop.test",
        amount: 500_000,
        callback_url: `http://127.0.0.1:${PORT}/callback`,
      }),
    }),
  )

  print({ link: started["authorization_url"], reference: started["reference"] })
}
