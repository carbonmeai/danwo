/**
 * A team board: someone posts (`POST /posts`), and everyone with the board open sees it at once,
 * over the board's WebSocket (`/live`). When its socket fails, the page reconnects and catches up
 * on what it missed (`GET /posts`). `TEAM_BUG=no-reconnect` leaves a failed socket down, so a
 * teammate whose connection dropped never sees the post.
 */
import { createServer, type ServerResponse } from "node:http"
import { text } from "node:stream/consumers"

import { WebSocketServer } from "ws"

const RECONNECT = process.env["TEAM_BUG"] !== "no-reconnect"

const PAGE = `<!doctype html>
<html><body>
  <h1>Team board</h1>
  <p>Connection: <span role="status" aria-label="Connection">connecting</span></p>
  <form id="post"><label>Message <input name="text"></label><button>Post</button></form>
  <ul aria-label="Posts"></ul>
  <script>
    const list = document.querySelector("ul")
    const status = document.querySelector("[role=status]")
    const shown = new Set()
    const show = (text) => {
      if (shown.has(text)) return
      shown.add(text)
      const item = document.createElement("li")
      item.textContent = text
      list.append(item)
    }
    const catchUp = async () => (await (await fetch("/posts")).json()).forEach(show)
    const connect = () => {
      const socket = new WebSocket(location.origin.replace("http", "ws") + "/live")
      socket.onopen = () => { status.textContent = "live"; catchUp() }
      socket.onmessage = (event) => show(event.data)
      socket.onclose = () => {
        status.textContent = "offline"
        if (${RECONNECT}) setTimeout(connect, 200)
      }
    }
    connect()
    document.getElementById("post").addEventListener("submit", async (event) => {
      event.preventDefault()
      const input = event.target.elements.text
      await fetch("/posts", { method: "POST", body: input.value })
      input.value = ""
    })
  </script>
</body></html>`

const posts: string[] = []

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value))
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/posts") {
    void text(req).then((body) => {
      posts.push(body)
      for (const client of live.clients) client.send(body)
      res.writeHead(204).end()
    })

    return
  }

  if (req.url === "/posts") return json(res, posts)

  res.writeHead(200, { "content-type": "text/html" }).end(PAGE)
})

const live = new WebSocketServer({ server, path: "/live" })

server.listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("board listening"))
