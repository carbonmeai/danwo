/**
 * The stack's frontend, served the way a dev server serves one: the page loads its client from
 * `/@vite/client` and its code from `/src/main.ts?v=…`. The code adds a task through the API,
 * listens to the API's event stream, and talks to it over a WebSocket. `VITE_API_URL` says where
 * the API is. `/media` shows an image from an outside host and fetches data from the same host.
 */
import { createServer } from "node:http"

const api = process.env.VITE_API_URL ?? ""

const PAGE = `<!doctype html>
<html>
  <head>
    <title>Tasks</title>
    <script type="module" src="/@vite/client"></script>
    <script>window.API = ${JSON.stringify(api)}</script>
    <script type="module" src="/src/main.ts?v=1a2b3c"></script>
  </head>
  <body>
    <h1>Tasks</h1>
    <button type="button" id="add">Add task</button>
    <p role="status" id="saved"></p>
    <p id="event">event: waiting</p>
    <p id="live">live: waiting</p>
  </body>
</html>`

const MAIN = `
const api = window.API
const show = (id, text) => (document.getElementById(id).textContent = text)

document.getElementById("add").addEventListener("click", async () => {
  const response = await fetch(api + "/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Write the report" }),
  })
  show("saved", response.ok ? "Task saved" : "Task not saved")
})

new EventSource(api + "/events").onmessage = (message) => show("event", "event: " + message.data)

const socket = new WebSocket(api.replace(/^http/, "ws") + "/live")
socket.onopen = () => socket.send("ping")
socket.onmessage = (message) => show("live", "live: " + message.data)
`

const MEDIA = `<!doctype html>
<html>
  <head>
    <title>Media</title>
  </head>
  <body>
    <h1>Media</h1>
    <p id="image">image: waiting</p>
    <p id="fetched">fetch: waiting</p>
    <img alt="Logo" src="https://images.unrouted.test/logo.png"
      onload="document.getElementById('image').textContent = 'image: settled'"
      onerror="document.getElementById('image').textContent = 'image: settled'">
    <script>
      fetch("https://images.unrouted.test/data.json")
        .then((response) => response.status, () => 0)
        .then((status) => (document.getElementById("fetched").textContent = "fetch: settled " + status))
    </script>
  </body>
</html>`

/** What the server sends for a path: the dev client, the page's code, the media page, or the page. */
function served(url: string | undefined): readonly [string, string] {
  if (url === "/@vite/client") return ["text/javascript", "export {}"]
  if (url?.startsWith("/src/main.ts")) return ["text/javascript", MAIN]
  if (url === "/media") return ["text/html", MEDIA]

  return ["text/html", PAGE]
}

createServer((req, res) => {
  const [type, body] = served(req.url)

  res.writeHead(200, { "content-type": type }).end(body)
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("web listening"))
