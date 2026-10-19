/**
 * A small stand-in for the Inngest dev server: it accepts events at `POST /e/<key>`, runs the one
 * function each triggers by calling the worker's endpoint (`WORKER_URL`), and reports runs at
 * `GET /v1/events/<id>/runs` in the shape the dev server's REST API answers with.
 */
import { createServer } from "node:http"

const port = Number(process.env.PORT)
const worker = process.env.WORKER_URL ?? ""

interface Run {
  readonly id: string
  status: "Running" | "Completed" | "Failed"
  readonly startedAt: string
  endedAt?: string
}

const runs = new Map<string, Run>()
let events = 0

async function run(event: string, body: string): Promise<void> {
  const entry = runs.get(event)

  if (entry === undefined) return

  try {
    const response = await fetch(`${worker}/api/inngest`, { method: "POST", body })

    entry.status = response.ok ? "Completed" : "Failed"
  } catch {
    entry.status = "Failed"
  }

  entry.endedAt = new Date().toISOString()
}

createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    if (req.method === "POST" && req.url?.startsWith("/e/")) {
      const id = `evt_${++events}`

      runs.set(id, { id: `run_${events}`, status: "Running", startedAt: new Date().toISOString() })
      /* The function runs a little later, as a queued step would. */
      setTimeout(() => void run(id, body), 300)
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ids: [id] }))

      return
    }

    const event = /^\/v1\/events\/([^/]+)\/runs$/.exec(req.url ?? "")?.[1]
    const entry = event === undefined ? undefined : runs.get(event)
    const data =
      entry === undefined
        ? []
        : [
            {
              run_id: entry.id,
              function_id: "provision-task",
              status: entry.status,
              run_started_at: entry.startedAt,
              ...(entry.endedAt !== undefined && { ended_at: entry.endedAt }),
            },
          ]

    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data }))
  })
}).listen(port, "127.0.0.1", () => console.log("inngest dev listening"))
