/**
 * A page load the machine's network really changed under: a form's POST is answered with a
 * redirect to an HTTPS checkout, and while the browser's tunnel to the checkout is still being set
 * up, a network interface comes up, as one does when Docker starts a container. Chromium fails the
 * load with net::ERR_NETWORK_CHANGED, and the session loads it again.
 *
 * It changes the machine's network, so it runs only on Linux, as root or with `sudo -n ip`, and
 * only when DANWO_TEST_NETWORK_CHANGE=1 asks for it (the slow workflow does).
 */
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { connect, createServer, type Server } from "node:net"

import { type Proxy, startProxy } from "@danwo/proxy"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession } from "../src/session.ts"

const SHOP = "https://shop.example.test"
const CHECKOUT = "https://checkout.example.test"
const INTERFACE = "danwo-nc0"
/** How long the first tunnel to the checkout is held, so the change lands while it is set up. */
const HOLD_MS = 1_500

/** `ip`, as root or through `sudo -n`. */
function ip(...args: string[]): void {
  const root = process.getuid?.() === 0

  execFileSync(root ? "ip" : "sudo", root ? args : ["-n", "ip", ...args], { stdio: "ignore" })
}

function canChangeNetwork(): boolean {
  if (process.platform !== "linux" || process.env["DANWO_TEST_NETWORK_CHANGE"] !== "1") return false

  try {
    ip("-V")

    return true
  } catch {
    return false
  }
}

let proxy: Proxy
let front: Server
let posts = 0

beforeAll(async () => {
  proxy = await startProxy({
    routes: [
      {
        hosts: ["shop.example.test"],
        handler: async (request) => {
          if (request.method !== "POST")
            return new Response('<form method="post" action="/buy"><button>Buy</button></form>', {
              headers: { "content-type": "text/html" },
            })

          posts += 1

          return new Response(null, { status: 303, headers: { location: `${CHECKOUT}/pay` } })
        },
      },
      {
        hosts: ["checkout.example.test"],
        handler: async () =>
          new Response("<h1>Checkout</h1>", { headers: { "content-type": "text/html" } }),
      },
    ],
    unmatched: "block",
  })

  /* In front of the proxy: holds the first tunnel to the checkout before passing it on. */
  let held = false
  const upstream = new URL(proxy.url)

  front = createServer((client) => {
    client.once("data", (first) => {
      const toCheckout = first.toString().startsWith("CONNECT checkout.example.test")
      const wait = toCheckout && !held ? HOLD_MS : 0

      if (toCheckout) held = true
      setTimeout(() => {
        const server = connect(Number(upstream.port), upstream.hostname, () => {
          server.write(first)
          client.pipe(server).pipe(client)
        })

        server.on("error", () => client.destroy())
        client.on("error", () => server.destroy())
      }, wait)
    })
  })
  front.listen(0, "127.0.0.1")
  await once(front, "listening")
})

afterAll(async () => {
  front.close()
  await proxy.stop()
})

describe.runIf(canChangeNetwork())("a network interface coming up mid-load", () => {
  it("fails the redirect's load with ERR_NETWORK_CHANGED, which the session loads again", async () => {
    const address = front.address()
    const port = typeof address === "object" && address !== null ? address.port : 0
    const session = await openWebSession({
      baseUrl: SHOP,
      proxy: { url: `http://127.0.0.1:${port}`, caSpki: proxy.caSpki },
    })

    try {
      await session.app.open("/")

      const change = setTimeout(() => {
        ip("link", "add", INTERFACE, "type", "dummy")
        ip("link", "set", INTERFACE, "up")
        ip("addr", "add", "198.18.255.1/32", "dev", INTERFACE)
      }, HOLD_MS / 3)

      await session.screen.getByRole("button", { name: "Buy" }).click()
      clearTimeout(change)

      expect(await session.screen.getByRole("heading").textContent()).toBe("Checkout")
      expect(posts).toBe(1)
      expect(session.flight.appLog().map((line) => [line.level, line.text])).toEqual(
        expect.arrayContaining([
          ["error", `${CHECKOUT}/pay could not be loaded: net::ERR_NETWORK_CHANGED`],
          [
            "warn",
            `${CHECKOUT}/pay: the machine's network changed while it loaded (net::ERR_NETWORK_CHANGED); loading it again (1 of 2)`,
          ],
        ]),
      )
    } finally {
      await session.close()

      try {
        ip("link", "delete", INTERFACE)
      } catch {
        /* It was never added. */
      }
    }
  }, 60_000)
})
