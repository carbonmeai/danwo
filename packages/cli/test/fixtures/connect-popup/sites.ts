/**
 * An app that connects an account through a provider's popup, the way an OAuth sign-in does: the
 * app opens the provider's "Connect your account" page in a new window, the person enters their
 * email and allows it, and the popup tells the app and closes. The provider is a second server, so
 * the popup shows another host. Save does nothing; a test clicks it so the filmed pointer is on the
 * page when a screenshot is compared.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import { listeningPort, type WorkerEnvironment } from "@danwo/sdk"

/** The app's page: a button that opens the provider's popup, and the account once connected. */
function appPage(provider: string): string {
  return `<!doctype html>
<title>Settings</title>
<h1>Settings</h1>
<p id="status">No account connected.</p>
<button type="button" id="connect">Connect your account</button>
<button type="button">Save</button>
<script>
  document.getElementById("connect").addEventListener("click", () => {
    window.open(${JSON.stringify(`${provider}/connect`)}, "connect", "popup,width=480,height=560")
  })
  window.addEventListener("message", (event) => {
    if (typeof event.data?.connected === "string")
      document.getElementById("status").textContent = "Connected as " + event.data.connected
  })
</script>`
}

/** The provider's page in the popup: an email, and Allow, which answers the app and closes. */
const CONNECT_PAGE = `<!doctype html>
<title>Connect your account</title>
<h1>Connect your account</h1>
<label>Email <input type="email" name="email"></label>
<button type="button" id="allow">Allow</button>
<script>
  document.getElementById("allow").addEventListener("click", () => {
    const email = document.querySelector("input").value
    window.opener?.postMessage({ connected: email }, "*")
    setTimeout(() => window.close(), 150)
  })
</script>`

async function serve(page: () => string): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(page())
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return { server, url: `http://127.0.0.1:${listeningPort(server)}` }
}

/** The app and the provider, one pair per worker. */
export async function connectEnvironment(): Promise<WorkerEnvironment> {
  const provider = await serve(() => CONNECT_PAGE)
  const app = await serve(() => appPage(provider.url.replace("127.0.0.1", "localhost")))

  return {
    baseUrl: app.url,
    async close() {
      app.server.close()
      provider.server.close()
    },
  }
}
