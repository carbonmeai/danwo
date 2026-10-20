import { execFile } from "node:child_process"
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type RawData, WebSocketServer } from "ws"

import { isPageAsset, type Proxy, startProxy } from "../src/index.ts"

const run = promisify(execFile)
const CLIENT = fileURLToPath(new URL("./fixtures/stack-client.ts", import.meta.url))

/** A frame's text, whichever form `ws` hands it over in. */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString()

  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString()
}

function portOf(server: Server): number {
  const address = server.address()

  if (address === null || typeof address === "string") throw new Error("not listening on a port")

  return address.port
}

/** A local app server: `/ok`, a server-sent event stream at `/events`, and a WebSocket echo. */
async function localApp(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      res.write("data: hello\n\n")

      return
    }

    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
  })
  const sockets = new WebSocketServer({ server })

  sockets.on("connection", (socket) => socket.on("message", (data) => socket.send(textOf(data))))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return { server, port: portOf(server) }
}

async function client(proxy: Proxy, mode: string, url: string): Promise<string> {
  const { stdout } = await run(process.execPath, [CLIENT, mode, url], {
    env: proxy.env(),
    timeout: 20_000,
  })

  return stdout.trim()
}

let app: { server: Server; port: number }

beforeAll(async () => {
  app = await localApp()
})

afterAll(() => {
  app.server.closeAllConnections()
  app.server.close()
})

describe("hosts a run always reaches", () => {
  it("lets this machine and allowed hosts through when unmatched hosts are blocked", async () => {
    const proxy = await startProxy({ routes: [], unmatched: "block", allow: ["example.com"] })

    try {
      expect(await client(proxy, "fetch", `http://127.0.0.1:${app.port}/ok`)).toBe("200")
      expect(await client(proxy, "fetch", `http://localhost:${app.port}/ok`)).toBe("200")
      expect(await client(proxy, "fetch", "https://unrouted.danwo.test/")).toBe("502")
      expect(proxy.exchanges().map((e) => `${e.disposition} ${e.host}`)).toEqual([
        "passthrough 127.0.0.1",
        "passthrough localhost",
        "blocked unrouted.danwo.test",
      ])
    } finally {
      await proxy.stop()
    }
  })

  it("says nothing is listening when a port of this machine is not served, in either mode", async () => {
    const closed = createServer()

    closed.listen(0, "127.0.0.1")
    await once(closed, "listening")
    const port = portOf(closed)

    closed.close()
    await once(closed, "close")

    for (const unmatched of ["block", "passthrough"] as const) {
      const proxy = await startProxy({ routes: [], unmatched })

      try {
        expect(await client(proxy, "text", `http://127.0.0.1:${port}/collections`)).toBe(
          `502 danwo proxy: nothing is listening on 127.0.0.1:${port}; start that service or route the host`,
        )
        expect(await client(proxy, "fetch", `http://127.0.0.1:${app.port}/ok`)).toBe("200")
      } finally {
        await proxy.stop()
      }
    }
  })

  it("passes a request a client proxied itself through once, not back to the proxy", async () => {
    const proxy = await startProxy({ routes: [], unmatched: "block" })
    const self = fileURLToPath(new URL("./fixtures/plain-agent-client.ts", import.meta.url))
    const send = async (env: NodeJS.ProcessEnv) =>
      (
        await run(process.execPath, [self, `http://localhost:${app.port}/ok`], {
          env,
          timeout: 20_000,
        })
      ).stdout.trim()

    try {
      expect(await send(proxy.env())).toBe("[200,200,200]")
      expect(proxy.exchanges().map((e) => `${e.disposition} ${e.host} ${e.status}`)).toEqual([
        "passthrough localhost 200",
        "passthrough localhost 200",
        "passthrough localhost 200",
      ])
    } finally {
      await proxy.stop()
    }
  })

  it("blocks telemetry hosts by default, and lets them go when asked", async () => {
    const blocking = await startProxy({ routes: [] })
    const passing = await startProxy({ routes: [], telemetry: "passthrough" })

    try {
      expect(await client(blocking, "fetch", "https://us.i.posthog.com/e/")).toBe("502")
      expect(blocking.exchanges()[0]?.disposition).toBe("blocked")
      await client(passing, "fetch", "https://us.i.posthog.com/e/").catch(() => "")
      expect(passing.exchanges()[0]?.disposition).toBe("passthrough")
    } finally {
      await blocking.stop()
      await passing.stop()
    }
  })
})

describe("long-lived responses", () => {
  it("does not wait for a server-sent event stream to settle", async () => {
    const proxy = await startProxy({ routes: [] })

    try {
      const listening = client(proxy, "stream", `http://127.0.0.1:${app.port}/events`)

      await expect.poll(() => proxy.exchanges()[0]?.stream).toBe(true)
      await proxy.settled(1_000)
      expect(await listening).toBe("200 data: hello")
    } finally {
      await proxy.stop()
    }
  })
})

describe("WebSockets", () => {
  it("passes a socket to this machine through and logs its frames", async () => {
    const proxy = await startProxy({ routes: [], unmatched: "block" })

    try {
      expect(await client(proxy, "socket", `ws://127.0.0.1:${app.port}/live`)).toBe("echo ping")
      await expect.poll(() => proxy.sockets()[0]?.closedAt).not.toBeNull()

      const [socket] = proxy.sockets()

      expect(socket).toMatchObject({
        disposition: "passthrough",
        host: "127.0.0.1",
        path: "/live",
        status: 101,
        fault: null,
        fromClient: { frames: 1, bytes: 4 },
        toClient: { frames: 1, bytes: 4 },
      })
    } finally {
      await proxy.stop()
    }
  })

  it("refuses blocked hosts and routed hosts that serve no sockets, cleanly", async () => {
    const proxy = await startProxy({
      routes: [{ hosts: ["api.danwo.test"], handler: async () => new Response("ok") }],
      blocked: ["ws.blocked.test"],
    })

    try {
      expect(await client(proxy, "socket", "wss://ws.blocked.test/")).toBe("refused 403")
      expect(await client(proxy, "socket", "wss://api.danwo.test/")).toBe("refused 501")
      expect(proxy.sockets().map((s) => `${s.disposition} ${s.host} ${s.status}`)).toEqual([
        "blocked ws.blocked.test 403",
        "routed api.danwo.test 501",
      ])
    } finally {
      await proxy.stop()
    }
  })

  it("refuses an upgrade or drops the connection under a socket fault", async () => {
    const proxy = await startProxy({ routes: [] })
    const url = `ws://127.0.0.1:${app.port}/live`

    try {
      proxy.setSocketFault(({ index }) => (index === 0 ? { kind: "refuse" } : { kind: "reset" }))
      expect(await client(proxy, "socket", url)).toBe("refused 503")
      expect(await client(proxy, "socket", url)).toMatch(/^error /)
      expect(proxy.sockets().map((s) => s.fault)).toEqual(["ws refuse", "ws reset"])

      proxy.setSocketFault(undefined)
      expect(await client(proxy, "socket", url)).toBe("echo ping")
    } finally {
      await proxy.stop()
    }
  })
})

describe("the page loading", () => {
  it("tells a dev server's modules and static files from the app's calls", () => {
    for (const path of [
      "/@vite/client",
      "/src/routes/index.tsx?v=1a2b3c",
      "/node_modules/.vite/deps/react.js?v=9f",
      "/src/main.ts",
      "/_next/static/chunks/app.js",
      "/assets/logo.svg",
      "/favicon.ico",
    ])
      expect(isPageAsset(path), path).toBe(true)

    for (const path of ["/api/tasks", "/v1/customers?limit=3", "/events", "/workspaces/1"])
      expect(isPageAsset(path), path).toBe(false)
  })
})
