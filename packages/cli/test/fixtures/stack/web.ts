/**
 * The stack's frontend, served the way a dev server serves one: the page loads its client from
 * `/@vite/client` and its code from `/src/main.ts?v=…`. The code adds a task through the API,
 * listens to the API's event stream, and talks to it over a WebSocket. `VITE_API_URL` says where
 * the API is.
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

createServer((req, res) => {
  if (req.url === "/@vite/client")
    return void res.writeHead(200, { "content-type": "text/javascript" }).end("export {}")
  if (req.url?.startsWith("/src/main.ts"))
    return void res.writeHead(200, { "content-type": "text/javascript" }).end(MAIN)

  res.writeHead(200, { "content-type": "text/html" }).end(PAGE)
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("web listening"))
