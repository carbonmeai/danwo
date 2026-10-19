/**
 * A small stand-in for the Inngest dev server: it accepts events at `POST /e/<key>`, runs the one
 * function each triggers by calling the worker's endpoint (`WORKER_URL`), and reports runs at
 * `GET /v1/events/<id>/runs` in the shape the dev server's REST API answers with.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const port = Number(process.env.PORT)
const worker = process.env.WORKER_URL ?? ""

interface Run {
  readonly id: string
  status: "Running" | "Completed" | "Failed"
  readonly startedAt: string
  endedAt?: string
}

const runs = new Map<string, Run>()

async function run(entry: Run, body: string): Promise<void> {
  const response = await fetch(`${worker}/api/inngest`, { method: "POST", body }).catch(
    () => undefined,
  )

  entry.status = response?.ok === true ? "Completed" : "Failed"
  entry.endedAt = new Date().toISOString()
}

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value))
}

/** An event: queued, and its function run a little later, as a queued step would be. */
function accept(res: ServerResponse, body: string): void {
  const id = `evt_${runs.size + 1}`
  const entry: Run = {
    id: `run_${runs.size + 1}`,
    status: "Running",
    startedAt: new Date().toISOString(),
  }

  runs.set(id, entry)
  setTimeout(() => void run(entry, body), 300)
  json(res, { ids: [id] })
}

function runOf(entry: Run) {
  return {
    run_id: entry.id,
    function_id: "provision-task",
    status: entry.status,
    run_started_at: entry.startedAt,
    ...(entry.endedAt !== undefined && { ended_at: entry.endedAt }),
  }
}

/** The runs an event triggered. */
function report(res: ServerResponse, url: string): void {
  const event = /^\/v1\/events\/([^/]+)\/runs$/.exec(url)?.[1] ?? ""
  const entry = runs.get(event)

  json(res, { data: entry === undefined ? [] : [runOf(entry)] })
}

function handle(req: IncomingMessage, res: ServerResponse, body: string): void {
  if (req.method === "POST" && req.url?.startsWith("/e/")) accept(res, body)
  else report(res, req.url ?? "")
}

createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => handle(req, res, body))
}).listen(port, "127.0.0.1", () => console.log("inngest dev listening"))
