/**
 * A stand-in for GitHub's check runs API: it records every request and answers like GitHub, or
 * refuses with 403 the way a token without `checks: write` is refused.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import { listeningPort } from "@danwo/emulators"

export interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly authorization: string | undefined
  readonly body: Record<string, unknown>
}

export interface FakeGitHub {
  readonly url: string
  readonly requests: RecordedRequest[]
  close(): Promise<void>
}

export async function startFakeGitHub(mode: "allow" | "deny" = "allow"): Promise<FakeGitHub> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    let raw = ""

    req.on("data", (chunk: Buffer) => (raw += chunk.toString()))
    req.on("end", () => {
      const body: Record<string, unknown> = raw === "" ? {} : JSON.parse(raw)

      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      })
      res.setHeader("content-type", "application/json")

      if (mode === "deny") {
        res.writeHead(403)
        res.end(JSON.stringify({ message: "Resource not accessible by integration" }))

        return
      }

      res.writeHead(req.method === "POST" ? 201 : 200)
      res.end(JSON.stringify({ id: 4242, ...body }))
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${listeningPort(server)}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
