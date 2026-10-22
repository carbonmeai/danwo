/**
 * A shop page that creates a Stripe product from the browser, behind the Stripe emulator and
 * served on a hostname the proxy routes (`shop.danwo.test`), so every engine sends each of its
 * requests through the proxy. Agent steps run on a scripted model that clicks the button it is
 * asked to; a replay calls no model.
 */
import { once } from "node:events"
import { createServer } from "node:http"

import { defineConfig, listeningPort, type Service, startServices, stripeService } from "@danwo/sdk"

import { ref, scripted } from "../../../../runner/test/fixtures/scripted.ts"

const PAGE = `<!doctype html>
<title>Lamp shop</title>
<style>body { font: 16px/1.4 sans-serif; margin: 24px } h1 { font-size: 24px }</style>
<h1>Lamp shop</h1>
<label>Product <input name="product" value="Lamp"></label>
<button type="button" id="create">Create product</button>
<p role="status" id="status">nothing yet</p>
<script>
  document.getElementById("create").addEventListener("click", async () => {
    const name = document.querySelector("input").value
    const answer = await fetch("https://api.stripe.com/v1/products", {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_danwo_engines",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "name=" + encodeURIComponent(name),
    })
    const product = await answer.json()

    document.getElementById("status").textContent =
      "Created " + product.name + (product.id.startsWith("prod_") ? " as a Stripe product" : "")
  })
</script>`

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  cache: { dir: ".danwo-cache" },
  /* The page sends a secret key from the browser to keep the fixture small; the lint would say so. */
  lint: false,
  model: scripted([(view) => ["click", { ref: ref(view, "button", "Create product") }]]),
  async environment() {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" }).end(PAGE)
    })

    server.listen(0, "127.0.0.1")
    await once(server, "listening")

    const shop: Service = {
      name: "shop",
      routes: [
        { hosts: ["shop.danwo.test"], upstream: `http://127.0.0.1:${listeningPort(server)}` },
      ],
      async close() {
        server.close()
      },
    }
    const services = await startServices([stripeService(), shop])

    return {
      baseUrl: "http://shop.danwo.test",
      proxy: services.proxy,
      webhooks: services.webhooks,
      settle: () => services.settle(),
      async close() {
        await services.close()
      },
    }
  },
})
