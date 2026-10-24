import { once } from "node:events"
import { createServer, request, type Server } from "node:http"

import { listeningPort } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { isPageCallToApp, type OutboundCall, startProxy } from "../src/index.ts"

/** What a browser's `fetch()` sends besides its body. */
const FETCH = {
  "user-agent": "Mozilla/5.0 (Macintosh) Chrome/140.0.0.0 Safari/537.36",
  "sec-fetch-dest": "empty",
}

/** What a browser sends when it loads a page. */
const NAVIGATION = { ...FETCH, "sec-fetch-dest": "document" }

/** What a server-side client sends. */
const SERVER = { "user-agent": "node" }

let app: Server
/** The paths the app was asked for, in order. */
let received: string[] = []

/** Sends `method url` through the proxy at `proxyUrl` with `headers`; its status, or the error. */
function viaProxy(
  proxyUrl: string,
  method: string,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<number | string> {
  const proxy = new URL(proxyUrl)

  return new Promise((resolve) => {
    request(
      {
        host: proxy.hostname,
        port: proxy.port,
        method,
        path: url,
        headers: { ...headers, host: new URL(url).host },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode ?? 0))
        res.on("error", (error) => resolve(error.message))
      },
    )
      .on("error", (error) => resolve(error.message))
      .end()
  })
}

beforeAll(async () => {
  app = createServer((req, res) => {
    received.push(`${req.method ?? ""} ${req.url ?? ""}`)
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}')
  })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
})

afterAll(() => {
  app.closeAllConnections()
  app.close()
})

describe("a page's calls to an app on this machine", () => {
  it("meet the fault rule, which can fail them before or after the app acts", async () => {
    const proxy = await startProxy({ routes: [], unmatched: "block" })
    const base = `http://127.0.0.1:${listeningPort(app)}`
    const seen: string[] = []

    received = []
    proxy.setFault((call: OutboundCall) => {
      seen.push(`${call.method} ${call.host}${call.path}`)
      if (call.path === "/api/signup") return { kind: "status", status: 500, body: "{}" }
      if (call.path === "/api/checkout") return { kind: "reset-after" }

      return undefined
    })

    try {
      expect(await viaProxy(proxy.url, "POST", `${base}/api/signup`, FETCH)).toBe(500)
      expect(await viaProxy(proxy.url, "POST", `${base}/api/checkout`, FETCH)).toEqual(
        expect.any(String),
      )
      expect(await viaProxy(proxy.url, "GET", `${base}/api/session`, FETCH)).toBe(200)
      // The page's own loads and the server's calls pass through, and the rule never sees them.
      expect(await viaProxy(proxy.url, "GET", `${base}/api/signup`, NAVIGATION)).toBe(200)
      expect(await viaProxy(proxy.url, "POST", `${base}/api/signup`, SERVER)).toBe(200)

      await proxy.settled()

      expect(seen).toEqual([
        "POST 127.0.0.1/api/signup",
        "POST 127.0.0.1/api/checkout",
        "GET 127.0.0.1/api/session",
      ])
      // The 500 never reached the app; reset-after did, and only its answer was lost.
      expect(received).toEqual([
        "POST /api/checkout",
        "GET /api/session",
        "GET /api/signup",
        "POST /api/signup",
      ])
      expect(
        proxy.exchanges().map((exchange) => [exchange.fault, isPageCallToApp(exchange)]),
      ).toEqual([
        ["status 500", true],
        ["reset-after", true],
        [null, true],
        [null, false],
        [null, false],
      ])
    } finally {
      await proxy.stop()
    }
  })
})
