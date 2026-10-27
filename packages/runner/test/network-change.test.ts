/**
 * Page loads the machine's network changing under them broke, loaded again. Chromium fails them
 * with net::ERR_NETWORK_CHANGED, which no route or CDP call can produce (their error reasons stop
 * at ERR_INTERNET_DISCONNECTED and the like, and a route never sees the GET a redirect leads to),
 * so here the app drops the connection of the loads it is told to, which the browser reports as
 * net::ERR_EMPTY_RESPONSE, and that reason counts as a network change. network-change.slow.test.ts
 * changes a Linux machine's network for real.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import type { Browser, Page } from "playwright-core"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { launchBrowser } from "../src/browser/index.ts"
import {
  gotoSurvivingNetworkChange,
  networkSettled,
  surviveNetworkChanges,
} from "../src/browser/network-change.ts"

const DROPPED = "net::ERR_EMPTY_RESPONSE"

let server: Server
let url: string
let browser: Browser
let page: Page
let notes: string[]
/** The requests the app answered, `METHOD /path`. */
let seen: string[]
/** How many more loads of each `METHOD /path` the app drops without an answer. */
let drops: Map<string, number>

beforeAll(async () => {
  server = createServer((req, res) => {
    const request = `${req.method} ${req.url}`
    const dropping = drops.get(request) ?? 0

    if (dropping > 0) {
      drops.set(request, dropping - 1)
      req.socket.destroy()

      return
    }

    seen.push(request)
    /* A fresh connection for every load, so the browser never retries one on its own. */
    res.setHeader("connection", "close")

    if (req.method === "POST" && req.url === "/buy") {
      res.writeHead(303, { location: "/checkout" })
      res.end()

      return
    }

    const body =
      req.url === "/checkout"
        ? "<h1>Checkout</h1>"
        : '<form method="post" action="/buy"><button>Buy</button></form>'

    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html><title>Shop</title>${body}`)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()

  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`
  browser = await launchBrowser({})
}, 60_000)

afterAll(async () => {
  await browser.close()
  server.close()
})

beforeEach(async () => {
  seen = []
  drops = new Map()
  notes = []
  page = await browser.newPage()
  surviveNetworkChanges(page, (level, text) => notes.push(`${level}: ${text}`), [DROPPED])

  return () => page.close()
})

/** Fails the next `times` loads of `path`, as a changed network would. */
function failNext(path: string, times = 1, method = "GET"): void {
  drops.set(`${method} ${path}`, times)
}

describe("a page load the network changing broke", () => {
  it("is loaded again when it is the GET a form's POST was redirected to, and the POST is sent once", async () => {
    await page.goto(url)
    failNext("/checkout")
    await page.getByRole("button", { name: "Buy" }).click()
    await networkSettled(page)

    expect(await page.getByRole("heading").textContent()).toBe("Checkout")
    expect(seen.filter((request) => request === "POST /buy")).toHaveLength(1)
    expect(notes).toEqual([
      `warn: ${url}/checkout: the machine's network changed while it loaded (${DROPPED}); loading it again (1 of 2)`,
    ])
  }, 60_000)

  it("is never sent again when it is a POST, and says why", async () => {
    await page.goto(url)
    failNext("/buy", 1, "POST")
    await page.getByRole("button", { name: "Buy" }).click()
    await networkSettled(page)

    expect(seen).toEqual(["GET /"])
    expect(notes).toEqual([
      `error: ${url}/buy: the machine's network changed while it loaded (${DROPPED}); not sent again, as a POST is never sent twice`,
    ])
  }, 60_000)

  it("gives up after two more tries, saying so", async () => {
    await page.goto(url)
    failNext("/checkout", 3)
    await page.getByRole("button", { name: "Buy" }).click()
    await networkSettled(page)

    expect(seen.filter((request) => request === "GET /checkout")).toEqual([])
    expect(notes).toEqual([
      `warn: ${url}/checkout: the machine's network changed while it loaded (${DROPPED}); loading it again (1 of 2)`,
      `warn: ${url}/checkout: the machine's network changed while it loaded (${DROPPED}); loading it again (2 of 2)`,
      `error: ${url}/checkout still could not be loaded after 2 tries: ${DROPPED}`,
    ])
  }, 60_000)

  it("is loaded again when danwo went there itself", async () => {
    failNext("/checkout")

    const response = await gotoSurvivingNetworkChange(page, `${url}/checkout`)

    expect(response?.status()).toBe(200)
    expect(seen).toEqual(["GET /checkout"])
    expect(notes).toHaveLength(1)
  }, 60_000)

  it("is left alone when it failed for another reason", async () => {
    await page.goto(url)
    await page.route(`${url}/buy`, (route) => route.abort("connectionrefused"))
    await page.getByRole("button", { name: "Buy" }).click()
    await networkSettled(page)

    expect(seen).toEqual(["GET /"])
    expect(notes).toEqual([])
  }, 60_000)
})
