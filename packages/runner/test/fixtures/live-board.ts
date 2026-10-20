/**
 * A tiny board people post to and watch live: `POST /posts` adds a post, and every open page
 * hears it over server-sent events (`/live`). It remembers the user agent of every request, so a
 * test can see whose browser asked.
 */
import { createServer, type ServerResponse } from "node:http"

const PAGE = `<!doctype html>
<html><body>
  <h1>Board</h1>
  <form id="post"><label>Message <input name="text"></label><button>Post</button></form>
  <ul id="posts" aria-label="Posts"></ul>
  <script>
    const list = document.getElementById("posts")
    const show = (text) => {
      const item = document.createElement("li")
      item.textContent = text
      list.append(item)
    }
    new EventSource("/live").onmessage = (event) => show(event.data)
    document.getElementById("post").addEventListener("submit", async (event) => {
      event.preventDefault()
      const input = event.target.elements.text
      await fetch("/posts", { method: "POST", body: input.value })
      input.value = ""
    })
  </script>
</body></html>`

export interface LiveBoard {
  readonly url: string
  /** The user agent of every request so far, in order. */
  readonly agents: readonly string[]
  close(): Promise<void>
}

/** Starts the board on a free port. */
export async function startLiveBoard(): Promise<LiveBoard> {
  const listeners = new Set<ServerResponse>()
  const agents: string[] = []
  const server = createServer((req, res) => {
    agents.push(req.headers["user-agent"] ?? "")

    if (req.url === "/live") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
      res.write(": open\n\n")
      listeners.add(res)
      req.on("close", () => listeners.delete(res))

      return
    }

    if (req.method === "POST" && req.url === "/posts") {
      let body = ""

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8")
      })
      req.on("end", () => {
        for (const listener of listeners) listener.write(`data: ${body}\n\n`)
        res.writeHead(204).end()
      })

      return
    }

    res.writeHead(200, { "content-type": "text/html" }).end(PAGE)
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  const address = server.address()

  if (address === null || typeof address === "string") throw new Error("the board did not listen")

  return {
    url: `http://127.0.0.1:${address.port}`,
    agents,
    close: () =>
      new Promise((resolve) => {
        for (const listener of listeners) listener.end()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
