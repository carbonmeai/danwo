/**
 * A small orders app for the agent's waits and failure checks: paying shows its confirmation a
 * moment later, one button calls an endpoint that answers 500, and another throws on the page.
 */
import { type HtmlServer, serveHtml } from "./html-server.ts"

const HOME = `<!doctype html><title>Orders</title><main>
<h1>Orders</h1>
<button type="button" id="pay">Pay</button>
<button type="button" id="charge">Charge card</button>
<p id="status"></p>
<script>
  document.getElementById("pay").addEventListener("click", () => {
    setTimeout(() => {
      const done = document.createElement("h2")
      done.textContent = "Payment received"
      document.querySelector("main").append(done)
    }, 400)
  })
  document.getElementById("charge").addEventListener("click", async () => {
    const res = await fetch("/api/charge", { method: "POST" })
    document.getElementById("status").textContent = res.ok ? "Charged" : "Something went wrong"
  })
</script></main>`

const CRASH = `<!doctype html><title>Crash</title><main><h1>Crash</h1>
<button type="button" onclick="setTimeout(() => { throw new Error('boom from the page') })">Crash</button>
</main>`

const CHARGE_FAILED = {
  status: 500,
  type: "application/json",
  body: '{"error":"card processor unreachable"}',
}

export function startOrdersSite(): Promise<HtmlServer> {
  return serveHtml((url) => {
    if (url.pathname === "/api/charge") return CHARGE_FAILED

    return url.pathname === "/crash" ? CRASH : HOME
  })
}
