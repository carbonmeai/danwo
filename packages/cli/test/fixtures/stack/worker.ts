/**
 * The stack's background worker: it serves the function the dev server calls for each task event
 * at `POST /api/inngest`, and says what it provisioned at `GET /provisioned`. It logs "worker
 * ready" once it listens, which is how the stack knows it started.
 */
import { createServer } from "node:http"

const provisioned: string[] = []

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/inngest") {
    let body = ""

    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => {
      const parsed: unknown = JSON.parse(body || "{}")
      const title =
        typeof parsed === "object" && parsed !== null && "data" in parsed
          ? String(Reflect.get(Object(parsed.data), "title") ?? "")
          : ""

      provisioned.push(title)
      console.log(`provisioned ${title}`)
      res.writeHead(200).end("ok")
    })

    return
  }

  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(provisioned))
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("worker ready"))
