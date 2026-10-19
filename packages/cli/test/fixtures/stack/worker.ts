/**
 * The stack's background worker: it serves the function the dev server calls for each task event
 * at `POST /api/inngest`, and says what it provisioned at `GET /provisioned`. It logs "worker
 * ready" once it listens, which is how the stack knows it started.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { z } from "zod"

const provisioned: string[] = []

const TaskEvent = z.object({ data: z.object({ title: z.string() }) })

/** The task title in an event's `data`, or an empty string. */
function titleOf(body: string): string {
  return TaskEvent.safeParse(JSON.parse(body || "{}")).data?.data.title ?? ""
}

function provision(req: IncomingMessage, res: ServerResponse): void {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    const title = titleOf(body)

    provisioned.push(title)
    console.log(`provisioned ${title}`)
    res.writeHead(200).end("ok")
  })
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/inngest") return provision(req, res)

  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(provisioned))
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("worker ready"))
