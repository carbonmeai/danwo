/**
 * The stack's API: `POST /tasks` creates a Stripe customer for the task with the official client
 * (its own HTTP agent) and sends a `task.created` event to Inngest; `GET /events` streams
 * server-sent events for as long as the page listens; `/live` is a WebSocket that answers "ping"
 * with "pong". Its start script sets NODE_OPTIONS itself, as many do.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"

import { Stripe } from "stripe"
import { type RawData, WebSocketServer } from "ws"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  httpAgent: new https.Agent({ keepAlive: true }),
  maxNetworkRetries: 0,
})
const inngest = `${process.env.INNGEST_BASE_URL ?? ""}/e/${process.env.INNGEST_EVENT_KEY ?? "dev"}`

function cors(res: ServerResponse): ServerResponse {
  return res
    .setHeader("access-control-allow-origin", "*")
    .setHeader("access-control-allow-headers", "content-type")
}

async function createTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = ""

  for await (const chunk of req) body += String(chunk)

  const parsed: unknown = JSON.parse(body || "{}")
  const title = typeof parsed === "object" && parsed !== null ? String(Reflect.get(parsed, "title")) : ""
  const customer = await stripe.customers.create({ description: title })

  await fetch(inngest, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "task.created", data: { title } }),
  })
  console.log(`task ${title} saved for ${customer.id}`)
  cors(res).writeHead(201, { "content-type": "application/json" })
  res.end(JSON.stringify({ title, customer: customer.id }))
}

function streamEvents(res: ServerResponse): void {
  cors(res).writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  res.write("data: hello\n\n")
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") return void cors(res).writeHead(204).end()
  if (req.method === "POST" && req.url === "/tasks")
    return void createTask(req, res).catch((error: unknown) => {
      console.log(`task failed: ${error instanceof Error ? error.message : "unknown"}`)
      cors(res).writeHead(502).end("could not save the task")
    })
  if (req.url === "/events") return streamEvents(res)

  cors(res).writeHead(200, { "content-type": "text/plain" }).end("api")
})

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString()

  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString()
}

new WebSocketServer({ server, path: "/live" }).on("connection", (socket) =>
  socket.on("message", (data) => socket.send(text(data) === "ping" ? "pong" : "?")),
)

server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("api listening"))
