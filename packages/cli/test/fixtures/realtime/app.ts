/**
 * A small app on three realtime providers, written as it would be against the real ones: placing
 * an order publishes it on a Pusher channel the page listens to and notifies the buyer through a
 * Novu workflow; the page's note is a document edited live over Tiptap Cloud's collaboration
 * socket. Its keys come from the environment; nothing in it knows about danwo.
 */
import { readFileSync } from "node:fs"
import { createServer, type ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import { Novu } from "@novu/api"
import { build } from "esbuild"
import Pusher from "pusher"

const require = createRequire(import.meta.url)
const env = (name: string) => process.env[name] ?? ""

const pusher = new Pusher({
  appId: env("PUSHER_APP_ID"),
  key: env("PUSHER_KEY"),
  secret: env("PUSHER_SECRET"),
  cluster: env("PUSHER_CLUSTER"),
  useTLS: true,
})
const novu = new Novu({ secretKey: env("NOVU_API_KEY") })

/** The page's collaboration code, bundled for the browser once at start. */
const collab = await build({
  entryPoints: [fileURLToPath(new URL("./collab-client.ts", import.meta.url))],
  bundle: true,
  format: "iife",
  write: false,
  platform: "browser",
}).then((out) => out.outputFiles[0]?.text ?? "")

const PAGE = `<!doctype html>
<html>
  <head>
    <title>Orders</title>
    <script src="/pusher.js"></script>
    <script>window.CONFIG = ${JSON.stringify({ key: env("PUSHER_KEY"), cluster: env("PUSHER_CLUSTER"), collabApp: env("TIPTAP_APP_ID"), collabToken: env("TIPTAP_TOKEN") })}</script>
    <script src="/collab.js"></script>
  </head>
  <body>
    <h1>Orders</h1>
    <p id="live">live: connecting</p>
    <button type="button" id="place">Place order</button>
    <p role="status" id="order"></p>
    <p id="note-state">note: connecting</p>
    <button type="button" id="note">Write note</button>
    <script>
      const pusher = new Pusher(CONFIG.key, { cluster: CONFIG.cluster })
      pusher.connection.bind("connected", () => (document.getElementById("live").textContent = "live: connected"))
      pusher.subscribe("orders").bind("order.placed", (order) => {
        document.getElementById("order").textContent = "Order " + order.id + " placed"
      })
      document.getElementById("place").addEventListener("click", () => fetch("/orders", { method: "POST" }))
    </script>
  </body>
</html>`

async function placeOrder(): Promise<void> {
  const order = { id: "o_1", total: 4200 }

  await pusher.trigger("orders", "order.placed", order)
  await novu.trigger({ workflowId: "order-placed", to: "buyer-1", payload: order })
}

/** The scripts the page loads: Pusher's client, and the bundled collaboration client. */
const SCRIPTS: Record<string, () => string | Buffer> = {
  "/pusher.js": () => readFileSync(require.resolve("pusher-js/dist/web/pusher.min.js")),
  "/collab.js": () => collab,
}

/** Places the order, answering 502 with the error when a provider refuses it. */
function placeOrderFor(res: ServerResponse): void {
  placeOrder().then(
    () => res.writeHead(201).end(),
    (error: unknown) => res.writeHead(502).end(String(error)),
  )
}

/** One of the page's scripts, or the page itself. */
function serve(res: ServerResponse, url: string | undefined): void {
  const script = SCRIPTS[url ?? ""]

  if (script) res.writeHead(200, { "content-type": "text/javascript" }).end(script())
  else res.writeHead(200, { "content-type": "text/html" }).end(PAGE)
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/orders") placeOrderFor(res)
  else serve(res, req.url)
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("orders listening"))
