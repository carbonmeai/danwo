import { once } from "node:events"
import { createServer, request, type Server } from "node:http"

import { listeningPort } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startProxy } from "../src/proxy.ts"

/** More of this machine's ports than an emitter takes listeners before Node warns of a leak. */
const PORTS = 12

let apps: Server[] = []

/** An app listening on 127.0.0.1 only, as most dev servers do, answering 200. */
async function localApp(): Promise<Server> {
  const server = createServer((_req, res) => res.writeHead(200).end("ok"))

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return server
}

/** GETs `url` through the proxy at `proxyUrl`, as an app with HTTP_PROXY set does; its status. */
function viaProxy(proxyUrl: string, url: string): Promise<number> {
  const proxy = new URL(proxyUrl)

  return new Promise((resolve, reject) => {
    request(
      { host: proxy.hostname, port: proxy.port, path: url, headers: { host: new URL(url).host } },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
      .on("error", reject)
      .end()
  })
}

beforeAll(async () => {
  apps = await Promise.all(Array.from({ length: PORTS }, localApp))
})

afterAll(() => {
  for (const app of apps) {
    app.closeAllConnections()
    app.close()
  }
})

describe("calls to localhost", () => {
  it("reach an app on 127.0.0.1 at every port without leaking listeners", async () => {
    const warnings: string[] = []
    const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`)
    const proxy = await startProxy({ routes: [] })

    process.on("warning", onWarning)

    try {
      for (const app of apps)
        expect(await viaProxy(proxy.url, `http://localhost:${listeningPort(app)}/ok`)).toBe(200)

      /* Node reports a warning on the next tick. */
      await new Promise((resolve) => setImmediate(resolve))
      expect(warnings.filter((warning) => warning.includes("MaxListeners"))).toEqual([])
    } finally {
      process.off("warning", onWarning)
      await proxy.stop()
    }
  }, 60_000)
})
