/**
 * Pages only an image shows properly: buttons drawn on a canvas, an icon button with no name, a
 * card form in a frame from another origin, and a password field to check what screenshots keep.
 * `?moved` draws the canvas's Buy button elsewhere; `?changed` draws a different button there.
 */
import { type HtmlServer, serveHtml } from "./html-server.ts"

export interface VisionSite {
  /** The app's origin, `http://127.0.0.1:<port>`. */
  readonly url: string
  close(): Promise<void>
}

/** Where the canvas sits on the page, and its buttons inside it, in CSS pixels. */
export const CANVAS = { left: 40, top: 80, width: 400, height: 200 }
export const BUY = { x: 20, y: 20, width: 120, height: 48 }
export const MOVED_BUY = { x: 260, y: 120, width: 120, height: 48 }
export const SELL = { x: 220, y: 20, width: 120, height: 48 }

/** The centre of a canvas button on the page. */
export function onPage(button: { x: number; y: number; width: number; height: number }) {
  return {
    x: CANVAS.left + button.x + button.width / 2,
    y: CANVAS.top + button.y + button.height / 2,
  }
}

const canvasPage = `<!doctype html><title>Trade</title>
<style>body{margin:0;font-family:sans-serif}canvas{position:absolute;left:${CANVAS.left}px;top:${CANVAS.top}px}</style>
<h1>Trade</h1><p data-testid="status">Idle</p>
<canvas id="board" width="${CANVAS.width}" height="${CANVAS.height}"></canvas>
<script>
const query = location.search
const buy = query.includes("moved") ? ${JSON.stringify(MOVED_BUY)} : ${JSON.stringify(BUY)}
const sell = ${JSON.stringify(SELL)}
const changed = query.includes("changed")
const canvas = document.getElementById("board")
const ctx = canvas.getContext("2d")
function button(box, fill, label) {
  ctx.fillStyle = fill
  ctx.fillRect(box.x, box.y, box.width, box.height)
  ctx.fillStyle = "#fff"
  ctx.font = "bold 18px sans-serif"
  ctx.fillText(label, box.x + 12, box.y + 30)
}
ctx.fillStyle = "#f1f5f9"
ctx.fillRect(0, 0, canvas.width, canvas.height)
button(buy, changed ? "#6b7280" : "#16a34a", changed ? "SOLD OUT" : "BUY ▲")
button(sell, "#dc2626", "SELL ▼")
ctx.fillStyle = "#0f172a"
ctx.font = "16px sans-serif"
ctx.fillText("Open orders: 42", 20, 190)
const inside = (box, x, y) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const status = document.querySelector("[data-testid=status]")
  if (!changed && inside(buy, x, y)) status.textContent = "Bought"
  else if (inside(sell, x, y)) status.textContent = "Sold"
})
</script>`

const iconsPage = `<!doctype html><title>Inbox</title>
<style>body{margin:0;font-family:sans-serif}</style>
<h1>Inbox</h1><p data-testid="status">Not starred</p>
<button style="position:absolute;left:100px;top:120px;width:48px;height:48px;border:0;background:#fde047"
  onclick="document.querySelector('[data-testid=status]').textContent = 'Starred'">
  <svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z" fill="#a16207"/></svg>
</button>`

const secretPage = `<!doctype html><title>Unlock</title>
<style>body{margin:0;font-family:sans-serif} input{position:absolute;left:100px;top:200px;width:240px;height:44px;font-size:28px}</style>
<h1>Unlock</h1><label>Password <input type="password" name="password"></label>`

function cardPage(widget: string): string {
  return `<!doctype html><title>Checkout</title><h1>Checkout</h1><p data-testid="status">Unpaid</p>
<iframe title="Card" src="${widget}/widget" style="width:420px;height:160px"></iframe>
<script>addEventListener("message", (event) => {
  document.querySelector("[data-testid=status]").textContent = String(event.data)
})</script>`
}

const widgetPage = `<!doctype html><title>Card</title>
<label>Card number <input name="card"></label>
<button onclick="parent.postMessage('Paid with card ending ' + document.querySelector('input').value.slice(-4), '*')">Pay</button>`

/** Starts the app and a widget server on another origin (`localhost` against `127.0.0.1`). */
export async function startVisionSite(): Promise<VisionSite> {
  const widget: HtmlServer = await serveHtml((url) =>
    url.pathname === "/widget" ? widgetPage : undefined,
  )
  const widgetOrigin = widget.url.replace("127.0.0.1", "localhost")
  const app = await serveHtml((url) => {
    const pages: Record<string, string> = {
      "/canvas": canvasPage,
      "/icons": iconsPage,
      "/secret": secretPage,
      "/card": cardPage(widgetOrigin),
    }

    return pages[url.pathname]
  })

  return {
    url: app.url,
    close: async () => {
      await app.close()
      await widget.close()
    },
  }
}
