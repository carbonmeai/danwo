/*
 * An app under test that knows nothing about the proxy: the official Bachs SDK on its sandbox host.
 * It creates a checkout when asked (a line on stdin), prints the hosted URL, and fulfils the order
 * only when a signed `collection.succeeded` webhook arrives, which it verifies with the SDK.
 */
import { once } from "node:events"
import { createServer } from "node:http"
import { createInterface } from "node:readline"

import { Bachs, webhooks } from "@bachs/sdk"

const bachs = new Bachs({ apiKey: process.env.BACHS_API_KEY, environment: "sandbox" })
const secret = process.env.BACHS_WEBHOOK_SECRET ?? ""
const server = createServer((request, response) => {
  const chunks: Buffer[] = []

  request.on("data", (chunk: Buffer) => chunks.push(chunk))
  request.on("end", () => {
    try {
      const event = webhooks.constructEvent(Buffer.concat(chunks), request.headers, secret)

      if (event.type === "collection.succeeded")
        console.log(JSON.stringify({ fulfilled: event.data["checkout_id"] }))
      response.writeHead(200).end()
    } catch {
      response.writeHead(400).end()
    }
  })
})

server.listen(0, "127.0.0.1")
await once(server, "listening")

const address = server.address()

console.log(JSON.stringify({ port: typeof address === "object" && address ? address.port : 0 }))

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()

await lines.next()

const checkout = await bachs.checkoutSessions.create(
  {
    pricing: { currency: "USD", amount: "29.00" },
    customer: { email: "jane@danwo-shop.com", name: "Jane Doe" },
    reference: "order_1042",
    success_url: "https://shop.example.com/thanks",
  },
  { idempotencyKey: "checkout-order_1042" },
)

console.log(
  JSON.stringify({ checkout_url: checkout.checkout_url, checkout_id: checkout.checkout_id }),
)
