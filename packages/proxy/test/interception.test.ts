/**
 * The proxy's own HTTP(S) and WebSocket handling, client and server both under the test's hand:
 * tunnels, TLS, framing, encodings, keep-alive, upgrades, aborts, headers, loops.
 */
import { X509Certificate } from "node:crypto"
import { once } from "node:events"
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from "node:http"
import { connect, createServer as createNetServer, type Socket } from "node:net"
import { connect as tlsConnect, TLSSocket } from "node:tls"
import { brotliCompressSync, deflateRawSync, gzipSync, zstdCompressSync } from "node:zlib"

import { listeningPort } from "@danwo/emulators"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { type RawData, WebSocket, WebSocketServer } from "ws"

import { createAuthority } from "../src/authority.ts"
import { decodeBody } from "../src/bodies.ts"
import { FrameCounter } from "../src/frames.ts"
import { http1Protocol, parseAuthority } from "../src/listener.ts"
import { type Proxy, startProxy } from "../src/proxy.ts"

/** What a test upstream saw of one request. */
interface Seen {
  readonly method: string
  readonly url: string
  readonly rawHeaders: readonly string[]
  readonly body: Buffer
  readonly trailers: readonly string[]
}

/** A plain HTTP server on 127.0.0.1 that records each request and answers through `answer`. */
async function upstream(
  answer: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void = (_req, res) =>
    res.end("ok"),
): Promise<{ server: Server; port: number; seen: Seen[] }> {
  const seen: Seen[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []

    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const body = Buffer.concat(chunks)

      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        rawHeaders: req.rawHeaders,
        body,
        trailers: req.rawTrailers,
      })
      answer(req, res, body)
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return { server, port: listeningPort(server), seen }
}

function close(server: Server) {
  server.closeAllConnections()
  server.close()
}

/** Opens a CONNECT tunnel to `target` through the proxy; the socket, once the proxy said 200. */
async function tunnel(proxy: Proxy, target: string): Promise<Socket> {
  const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1")

  await once(socket, "connect")
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)

  const [first]: unknown[] = await once(socket, "data")

  expect(String(first)).toMatch(/^HTTP\/1\.1 200 /)

  return socket
}

/** TLS through a tunnel to `target`, trusting the proxy's CA alone. */
async function secureTunnel(
  proxy: Proxy,
  target: string,
  options: { servername?: string; ALPNProtocols?: string[] } = {},
): Promise<TLSSocket> {
  const socket = await tunnel(proxy, target)
  const host = parseAuthority(target, 443)?.hostname ?? ""
  const secure = tlsConnect({
    socket,
    ca: proxy.caCert,
    servername: options.servername ?? host,
    ...(options.ALPNProtocols && { ALPNProtocols: options.ALPNProtocols }),
  })

  secure.on("error", () => {})
  await once(secure, "secureConnect")

  return secure
}

/** Sends one raw HTTP/1.1 request on `socket` and reads until the server closes it or `until` matches. */
async function exchangeRaw(socket: Socket | TLSSocket, request: string, until?: RegExp) {
  let text = ""

  socket.write(request)

  return new Promise<string>((resolve) => {
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("latin1")
      if (until?.test(text)) resolve(text)
    })
    socket.on("close", () => resolve(text))
    socket.on("error", () => resolve(text))
  })
}

/** A GET of `url` through the proxy in absolute form, as an `HTTP_PROXY` client sends it. */
function viaProxy(
  proxy: Proxy,
  url: string,
  options: { method?: string; headers?: Record<string, string | string[]>; body?: string } = {},
): Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer } | string> {
  const at = new URL(proxy.url)

  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: at.hostname,
        port: at.port,
        method: options.method ?? "GET",
        path: url,
        headers: { host: new URL(url).host, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = []

        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        )
        res.on("error", (error) => resolve(error.message))
      },
    )

    req.on("error", (error) => resolve(error.message))
    req.end(options.body)
  })
}

/** A frame's text, whichever form `ws` hands it over in. */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString()

  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString()
}

/** Name-value pairs of a flat raw header list. */
function pairs(raw: readonly string[]): [string, string][] {
  const out: [string, string][] = []

  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i] ?? "", raw[i + 1] ?? ""])

  return out
}

let proxies: Proxy[] = []

async function proxyFor(options: Parameters<typeof startProxy>[0]): Promise<Proxy> {
  const proxy = await startProxy(options)

  proxies.push(proxy)

  return proxy
}

afterEach(async () => {
  await Promise.all(proxies.map((proxy) => proxy.stop()))
  proxies = []
  vi.restoreAllMocks()
})

describe("certificates", () => {
  it("signs a certificate for each host, with its name or address in the SAN and the CA after it", async () => {
    const authority = await createAuthority("test CA")
    const ca = new X509Certificate(authority.cert)

    expect(ca.ca).toBe(true)
    expect(ca.checkIssued(ca)).toBe(true)
    expect(authority.spki).toMatch(/^[A-Za-z0-9+/]{43}=$/)

    const long = `${"a".repeat(60)}.danwo.test`
    const proxy = await proxyFor({ routes: [] })

    for (const host of ["api.danwo.test", long, "a_b.danwo.test"]) {
      const secure = await secureTunnel(proxy, `${host}:443`)
      const peer = secure.getPeerX509Certificate()

      expect(peer?.checkHost(host)).toBe(host)
      expect(peer?.issuer).toBe(new X509Certificate(proxy.caCert).subject)
      secure.destroy()
    }
  })

  it("names an address in the certificate when the client sends no server name", async () => {
    const app = await upstream()
    const proxy = await proxyFor({ routes: [] })

    try {
      const socket = await tunnel(proxy, `127.0.0.1:${app.port}`)
      const secure = tlsConnect({ socket, ca: proxy.caCert, host: "127.0.0.1" })

      await once(secure, "secureConnect")
      expect(secure.authorized).toBe(true)
      expect(secure.getPeerX509Certificate()?.checkIP("127.0.0.1")).toBe("127.0.0.1")
      secure.destroy()
    } finally {
      close(app.server)
    }
  })

  it("covers a name with an underscore by its parent's wildcard too, and leaves a long name out of the CN", async () => {
    const proxy = await proxyFor({ routes: [] })
    const secure = await secureTunnel(proxy, "a_b.danwo.test:443")

    expect(secure.getPeerX509Certificate()?.subjectAltName).toBe(
      "DNS:a_b.danwo.test, DNS:*.danwo.test",
    )
    secure.destroy()

    const long = `${"b".repeat(40)}.${"c".repeat(40)}.danwo.test`
    const other = await secureTunnel(proxy, `${long}:443`)

    const peer = other.getPeerX509Certificate()

    expect(peer?.checkHost(long)).toBe(long)
    expect(peer?.subject).toBeFalsy()
    other.destroy()
  })
})

describe("one port for HTTP, CONNECT and TLS", () => {
  it("answers absolute-form HTTP, a plain tunnel and a TLS tunnel on the same port", async () => {
    const proxy = await proxyFor({
      routes: [
        { hosts: ["api.danwo.test"], handler: async (r) => new Response(new URL(r.url).href) },
      ],
    })

    const plain = await viaProxy(proxy, "http://api.danwo.test/a?b=1")

    expect(typeof plain !== "string" && plain.body.toString()).toBe("http://api.danwo.test/a?b=1")

    const inTunnel = await exchangeRaw(
      await tunnel(proxy, "api.danwo.test:8080"),
      "GET /plain HTTP/1.1\r\nHost: api.danwo.test:8080\r\nConnection: close\r\n\r\n",
    )

    expect(inTunnel).toContain("http://api.danwo.test:8080/plain")

    const secure = await exchangeRaw(
      await secureTunnel(proxy, "api.danwo.test:443"),
      "GET /tls HTTP/1.1\r\nHost: api.danwo.test\r\nConnection: close\r\n\r\n",
    )

    expect(secure).toContain("https://api.danwo.test/tls")
  })

  it("takes TLS sent straight to its port, going by the Host header", async () => {
    const proxy = await proxyFor({
      routes: [
        { hosts: ["api.danwo.test"], handler: async (r) => new Response(new URL(r.url).href) },
      ],
    })
    const secure = tlsConnect({
      host: "127.0.0.1",
      port: Number(new URL(proxy.url).port),
      servername: "api.danwo.test",
      ca: proxy.caCert,
    })

    await once(secure, "secureConnect")

    const answer = await exchangeRaw(
      secure,
      "GET /direct HTTP/1.1\r\nHost: api.danwo.test\r\nConnection: close\r\n\r\n",
    )

    expect(answer).toContain("https://api.danwo.test/direct")
  })

  it("speaks HTTP/1.1 to a client that offers HTTP/2 too, and turns away one that offers HTTP/2 alone", async () => {
    expect(http1Protocol(["h2", "http/1.1"])).toBe("http/1.1")
    expect(http1Protocol(["h2"])).toBeUndefined()

    const proxy = await proxyFor({ routes: [] })
    const both = await secureTunnel(proxy, "api.danwo.test:443", {
      ALPNProtocols: ["h2", "http/1.1"],
    })

    expect(both.alpnProtocol).toBe("http/1.1")
    both.destroy()

    const socket = await tunnel(proxy, "api.danwo.test:443")
    const only = tlsConnect({
      socket,
      ca: proxy.caCert,
      servername: "api.danwo.test",
      ALPNProtocols: ["h2"],
    })
    const [error]: unknown[] = await once(only, "error")

    expect(Reflect.get(Object(error), "code")).toBe("ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL")
  })

  it("parses a CONNECT target with or without a port, and an IPv6 address in brackets", () => {
    expect(parseAuthority("API.Danwo.test.:8443", 443)).toEqual({
      hostname: "api.danwo.test",
      port: 8443,
    })
    expect(parseAuthority("api.danwo.test", 443)).toEqual({ hostname: "api.danwo.test", port: 443 })
    expect(parseAuthority("[::1]:3000", 80)).toEqual({ hostname: "::1", port: 3000 })
    expect(parseAuthority("::1", 80)).toBeUndefined()
    expect(parseAuthority("host:99999", 80)).toBeUndefined()
  })

  it("answers a CONNECT that names no port with a tunnel to 443", async () => {
    const proxy = await proxyFor({
      routes: [
        { hosts: ["api.danwo.test"], handler: async (r) => new Response(new URL(r.url).href) },
      ],
    })
    const secure = await secureTunnel(proxy, "api.danwo.test")
    const answer = await exchangeRaw(
      secure,
      "GET / HTTP/1.1\r\nHost: api.danwo.test\r\nConnection: close\r\n\r\n",
    )

    expect(answer).toContain("https://api.danwo.test/")
  })
})

describe("bodies", () => {
  let app: Awaited<ReturnType<typeof upstream>>

  beforeAll(async () => {
    app = await upstream((req, res, body) => {
      if (req.url === "/trailers") {
        res.writeHead(200, { trailer: "x-checksum" })
        res.write("part one ")
        res.addTrailers({ "x-checksum": "abc123" })
        res.end("part two")

        return
      }

      if (req.url === "/gzip") {
        res.writeHead(200, { "content-encoding": "gzip", "content-type": "application/json" })
        res.end(gzipSync('{"compressed":true}'))

        return
      }

      res.end(`got ${body.length} bytes`)
    })
  })

  afterAll(() => close(app.server))

  it("passes a chunked request body on whole, with its trailers", async () => {
    const proxy = await proxyFor({ routes: [] })
    const at = new URL(proxy.url)
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: at.hostname,
          port: at.port,
          method: "POST",
          path: `http://127.0.0.1:${app.port}/chunked`,
          headers: {
            host: `127.0.0.1:${app.port}`,
            "transfer-encoding": "chunked",
            trailer: "x-sum",
          },
        },
        (res) => {
          res.resume()
          res.on("end", () => resolve(res.statusCode ?? 0))
        },
      )

      req.on("error", reject)
      req.write("first,")
      req.write("second")
      req.addTrailers({ "x-sum": "42" })
      req.end()
    })

    expect(status).toBe(200)
    expect(app.seen.at(-1)).toMatchObject({ method: "POST", body: Buffer.from("first,second") })
    expect(app.seen.at(-1)?.trailers).toEqual(["x-sum", "42"])
  })

  it("streams a chunked response back with its trailers", async () => {
    const proxy = await proxyFor({ routes: [] })
    const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1")

    await once(socket, "connect")

    const answer = await exchangeRaw(
      socket,
      `GET http://127.0.0.1:${app.port}/trailers HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nTE: trailers\r\n\r\n`,
      /\r\n0\r\n[\s\S]*\r\n\r\n$/,
    )

    socket.destroy()
    expect(answer).toMatch(/transfer-encoding: chunked/i)
    expect(answer).toContain("part one ")
    expect(answer).toMatch(/x-checksum: abc123/i)
  })

  it("passes a compressed answer through as it came, and records it decoded", async () => {
    const proxy = await proxyFor({ routes: [] })
    const got = await viaProxy(proxy, `http://127.0.0.1:${app.port}/gzip`, {
      headers: { "accept-encoding": "gzip" },
    })

    expect(typeof got !== "string" && got.headers["content-encoding"]).toBe("gzip")
    expect(typeof got !== "string" && got.body.equals(gzipSync('{"compressed":true}'))).toBe(true)
    await proxy.settled()
    expect(proxy.exchanges()[0]?.response?.body).toBe('{"compressed":true}')
  })

  it("decodes a compressed request body for a route's handler, and keeps one it cannot decode as it came", async () => {
    const received: string[] = []
    const proxy = await proxyFor({
      routes: [
        {
          hosts: ["api.danwo.test"],
          handler: async (request) => {
            received.push(
              `${request.headers.get("content-encoding") ?? "-"} ${await request.text()}`,
            )

            return new Response("ok")
          },
        },
      ],
    })
    const send = (encoding: string, body: Buffer) =>
      new Promise<void>((resolve, reject) => {
        const at = new URL(proxy.url)
        const req = httpRequest(
          {
            host: at.hostname,
            port: at.port,
            method: "POST",
            path: "http://api.danwo.test/upload",
            headers: { host: "api.danwo.test", "content-encoding": encoding },
          },
          (res) => {
            res.resume()
            res.on("end", resolve)
          },
        )

        req.on("error", reject)
        req.end(body)
      })

    await send("gzip", gzipSync("gzipped"))
    await send("br", brotliCompressSync("brotli"))
    await send("zstd", zstdCompressSync("zstandard"))
    await send("deflate", deflateRawSync("raw deflate"))
    await send("aws-chunked", Buffer.from("as it came"))

    expect(received).toEqual([
      "- gzipped",
      "- brotli",
      "- zstandard",
      "- raw deflate",
      "aws-chunked as it came",
    ])
    expect(await decodeBody(Buffer.from("x"), "gzip")).toBeUndefined()
  })

  it("sends a body-less POST on with an empty length rather than an empty chunked body", async () => {
    const proxy = await proxyFor({ routes: [] })

    await viaProxy(proxy, `http://127.0.0.1:${app.port}/empty`, { method: "POST" })

    const headers = pairs(app.seen.at(-1)?.rawHeaders ?? []).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ])

    expect(headers).toContainEqual(["content-length", "0"])
    expect(headers.map(([name]) => name)).not.toContain("transfer-encoding")
  })
})

describe("headers", () => {
  it("passes headers on in their own case and order, without the hop-by-hop ones", async () => {
    const app = await upstream()
    const proxy = await proxyFor({ routes: [] })

    try {
      const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1")

      await once(socket, "connect")
      await exchangeRaw(
        socket,
        [
          `GET http://127.0.0.1:${app.port}/headers HTTP/1.1`,
          `Host: 127.0.0.1:${app.port}`,
          "X-CamelCase: one",
          "x-repeated: a",
          "X-Repeated: b",
          "Proxy-Authorization: Basic c2VjcmV0",
          "Proxy-Connection: keep-alive",
          "X-Hop: drop me",
          "Connection: X-Hop, close",
          "",
          "",
        ].join("\r\n"),
      )

      const names = pairs(app.seen.at(-1)?.rawHeaders ?? []).map(([name]) => name)

      expect(names).toEqual(
        expect.arrayContaining(["Host", "X-CamelCase", "x-repeated", "X-Repeated"]),
      )
      expect(names.indexOf("x-repeated")).toBeLessThan(names.indexOf("X-Repeated"))
      expect(names.map((name) => name.toLowerCase())).not.toEqual(
        expect.arrayContaining(["proxy-authorization"]),
      )
      expect(names.map((name) => name.toLowerCase())).not.toContain("x-hop")
      expect(names.map((name) => name.toLowerCase())).not.toContain("proxy-connection")
    } finally {
      close(app.server)
    }
  })

  it("takes request headers past Node's default 16 KiB", async () => {
    const app = createServer({ maxHeaderSize: 64 * 1024 }, (req, res) =>
      res.end(String(req.headers.cookie?.length ?? 0)),
    )

    app.listen(0, "127.0.0.1")
    await once(app, "listening")

    const proxy = await proxyFor({ routes: [] })

    try {
      const got = await viaProxy(proxy, `http://127.0.0.1:${listeningPort(app)}/big`, {
        headers: { cookie: `session=${"x".repeat(30_000)}` },
      })

      expect(typeof got !== "string" && got.body.toString()).toBe("30008")
    } finally {
      close(app)
    }
  })

  it("leaves out a header Node would refuse to write, and keeps the rest", async () => {
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: async () => new Response("ok") }],
    })

    proxy.failNext(() => true, {
      kind: "status",
      status: 503,
      body: "busy",
      headers: { "x-good": "yes", "x-bad": "one\ntwo" },
    })

    const got = await viaProxy(proxy, "http://api.danwo.test/")

    expect(typeof got !== "string" && got.status).toBe(503)
    expect(typeof got !== "string" && got.headers["x-good"]).toBe("yes")
    expect(typeof got !== "string" && got.headers["x-bad"]).toBeUndefined()
    expect(typeof got !== "string" && got.body.toString()).toBe("busy")
  })

  it("adds a Host header for an HTTP/1.0 request that has none", async () => {
    const app = await upstream()
    const proxy = await proxyFor({ routes: [] })

    try {
      const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1")

      await once(socket, "connect")

      const answer = await exchangeRaw(
        socket,
        `GET http://127.0.0.1:${app.port}/old HTTP/1.0\r\n\r\n`,
      )

      expect(answer).toMatch(/^HTTP\/1\.[01] 200/)
      expect(pairs(app.seen.at(-1)?.rawHeaders ?? [])).toContainEqual([
        "Host",
        `127.0.0.1:${app.port}`,
      ])
    } finally {
      close(app.server)
    }
  })
})

describe("Expect", () => {
  it("answers 100-continue itself, so the body follows, and passes another expectation on", async () => {
    const app = await upstream()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: async (r) => new Response(await r.text()) }],
    })
    const at = new URL(proxy.url)
    const send = (url: string, expectation: string) =>
      new Promise<{ status: number; body: string; continued: boolean }>((resolve, reject) => {
        let continued = false
        const req = httpRequest(
          {
            host: at.hostname,
            port: at.port,
            method: "POST",
            path: url,
            headers: { host: new URL(url).host, expect: expectation, "content-length": "5" },
          },
          (res) => {
            let body = ""

            res.on("data", (chunk: Buffer) => (body += chunk.toString()))
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body, continued }))
          },
        )

        req.on("continue", () => {
          continued = true
          req.end("hello")
        })
        req.on("error", reject)
        if (expectation !== "100-continue") req.end("hello")
      })

    try {
      expect(await send("http://api.danwo.test/", "100-continue")).toEqual({
        status: 200,
        body: "hello",
        continued: true,
      })
      expect(await send(`http://127.0.0.1:${app.port}/`, "100-continue")).toMatchObject({
        status: 200,
        continued: true,
      })
      expect(app.seen.at(-1)?.body.toString()).toBe("hello")
      expect(await send("http://api.danwo.test/", "x-something-else")).toMatchObject({
        status: 200,
        body: "hello",
      })
    } finally {
      close(app.server)
    }
  })
})

describe("keep-alive", () => {
  it("answers several requests on one client connection, each recorded", async () => {
    const proxy = await proxyFor({
      routes: [
        { hosts: ["api.danwo.test"], handler: async (r) => new Response(new URL(r.url).pathname) },
      ],
    })
    const secure = await secureTunnel(proxy, "api.danwo.test:443")
    const answer = await exchangeRaw(
      secure,
      [1, 2, 3]
        .map(
          (n) =>
            `GET /${n} HTTP/1.1\r\nHost: api.danwo.test\r\n${n === 3 ? "Connection: close\r\n" : ""}\r\n`,
        )
        .join(""),
    )

    expect(answer.match(/HTTP\/1\.1 200/g)).toHaveLength(3)
    await proxy.settled()
    expect(proxy.exchanges().map((e) => e.path)).toEqual(["/1", "/2", "/3"])
  })

  it("sends a request again on a new connection when the kept-alive one it went on had closed", async () => {
    const perSocket = new Map<Socket, number>()
    const app = createServer((req, res) => {
      const count = (perSocket.get(req.socket) ?? 0) + 1

      perSocket.set(req.socket, count)
      /* The second request on a kept connection finds it closed, as one closing just then would. */
      if (count > 1) req.socket.destroy()
      else res.end(`answer ${count}`)
    })

    app.listen(0, "127.0.0.1")
    await once(app, "listening")

    const proxy = await proxyFor({ routes: [] })

    try {
      const url = `http://127.0.0.1:${listeningPort(app)}/again`
      const first = await viaProxy(proxy, url)
      const second = await viaProxy(proxy, url)

      expect(typeof first !== "string" && first.status).toBe(200)
      expect(typeof second !== "string" && second.status).toBe(200)
      expect(perSocket.size).toBe(2)
    } finally {
      close(app)
    }
  })
})

describe("aborted requests", () => {
  it("records a request whose client went away, and stops asking the host for it", async () => {
    let upstreamClosed = false
    const app = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" })
      res.write("first part")
      res.on("close", () => (upstreamClosed = true))
    })

    app.listen(0, "127.0.0.1")
    await once(app, "listening")

    const proxy = await proxyFor({ routes: [] })

    try {
      const at = new URL(proxy.url)
      const url = `http://127.0.0.1:${listeningPort(app)}/slow`

      await new Promise<void>((resolve) => {
        const req = httpRequest(
          { host: at.hostname, port: at.port, path: url, headers: { host: new URL(url).host } },
          (res) =>
            res.once("data", () => {
              req.destroy()
              resolve()
            }),
        )

        req.on("error", () => resolve())
        req.end()
      })

      await expect.poll(() => upstreamClosed).toBe(true)
      await proxy.settled()
      expect(proxy.exchanges()[0]).toMatchObject({ aborted: true, status: null })
    } finally {
      close(app)
    }
  })

  it("prints nothing when a client drops its connection or turns the handshake down", async () => {
    const lines = vi.spyOn(console, "error").mockImplementation(() => {})
    const logs = vi.spyOn(console, "log").mockImplementation(() => {})
    const proxy = await proxyFor({ routes: [] })
    const socket = await tunnel(proxy, "api.danwo.test:443")
    /* A client that does not trust the CA aborts the handshake. */
    const distrusting = tlsConnect({ socket, servername: "api.danwo.test" })

    await once(distrusting, "error")

    const dropped = await tunnel(proxy, "api.danwo.test:443")

    dropped.resetAndDestroy()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lines).not.toHaveBeenCalled()
    expect(logs).not.toHaveBeenCalled()
  })
})

describe("this machine", () => {
  let app: Awaited<ReturnType<typeof upstream>>

  beforeAll(async () => {
    app = await upstream((req, res) => res.end(req.headers.host ?? ""))
  })

  afterAll(() => close(app.server))

  it("reaches an app on 127.0.0.1 by a localhost subdomain, keeping its Host", async () => {
    const proxy = await proxyFor({ routes: [] })
    const got = await viaProxy(proxy, `http://app.localhost:${app.port}/`)

    expect(typeof got !== "string" && got.body.toString()).toBe(`app.localhost:${app.port}`)
  })

  it("dials 0.0.0.0 as this machine", async () => {
    const proxy = await proxyFor({ routes: [] })
    const got = await viaProxy(proxy, `http://0.0.0.0:${app.port}/`)

    expect(typeof got !== "string" && got.status).toBe(200)
  })

  it("passes HTTPS on to an app here without checking its development certificate", async () => {
    const authority = await createAuthority("a local dev CA")
    const context = await authority.contextFor("localhost")
    const secureApp = createNetServer((raw) => {
      const tls = new TLSSocket(raw, {
        isServer: true,
        secureContext: context,
      })

      tls.on("error", () => {})
      tls.once("data", () =>
        tls.end("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecure"),
      )
    })

    secureApp.listen(0, "127.0.0.1")
    await once(secureApp, "listening")

    const proxy = await proxyFor({ routes: [] })

    try {
      const port = listeningPort(secureApp)
      const secure = await secureTunnel(proxy, `localhost:${port}`)
      const answer = await exchangeRaw(
        secure,
        `GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
      )

      expect(answer).toMatch(/^HTTP\/1\.1 200[\s\S]*secure$/)
    } finally {
      secureApp.close()
    }
  })

  it("says why a host could not be reached", async () => {
    const proxy = await proxyFor({ routes: [] })
    const got = await viaProxy(proxy, "http://nowhere.invalid/")

    expect(typeof got !== "string" && got.status).toBe(502)
    expect(typeof got !== "string" && got.body.toString()).toMatch(
      /^danwo proxy: could not reach nowhere\.invalid:80 \(/,
    )
  })
})

describe("upgrades", () => {
  it("forwards a WSS socket to a route's upstream, passing its subprotocol and close code through", async () => {
    const server = createServer()
    const sockets = new WebSocketServer({
      server,
      handleProtocols: (offered) => [...offered][1] ?? false,
    })
    let hostSeen = ""

    sockets.on("connection", (socket, req) => {
      hostSeen = req.headers.host ?? ""
      socket.on("message", (data: RawData, binary) => socket.send(data, { binary }))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")

    const target = `ws://127.0.0.1:${listeningPort(server)}`
    const proxy = await proxyFor({
      routes: [
        { hosts: ["realtime.danwo.test"], handler: async () => new Response(), webSocket: target },
      ],
    })

    try {
      const secure = await secureTunnel(proxy, "realtime.danwo.test:443")
      const client = new WebSocket("wss://realtime.danwo.test/live", ["one", "two"], {
        createConnection: () => secure,
      })
      const [message] = await new Promise<[string]>((resolve) => {
        client.on("open", () => client.send("hello there"))
        client.on("message", (data: RawData) => resolve([textOf(data)]))
      })

      expect(client.protocol).toBe("two")
      expect(message).toBe("hello there")
      client.close(4001, "done")
      await expect.poll(() => proxy.sockets()[0]?.closedAt, { timeout: 5_000 }).not.toBeNull()
      expect(proxy.sockets()[0]).toMatchObject({
        disposition: "routed",
        host: "realtime.danwo.test",
        path: "/live",
        status: 101,
        closeCode: 4001,
        aborted: false,
        fromClient: { frames: 1, bytes: 11 },
        toClient: { frames: 1, bytes: 11 },
      })
      expect(hostSeen).toBe(`127.0.0.1:${listeningPort(server)}`)
    } finally {
      sockets.close()
      close(server)
    }
  })

  it("answers another upgrade (h2c) as an ordinary request", async () => {
    const app = await upstream((req, res) => res.end(`plain ${req.headers.upgrade ?? "none"}`))
    const proxy = await proxyFor({ routes: [] })

    try {
      const socket = connect(Number(new URL(proxy.url).port), "127.0.0.1")

      await once(socket, "connect")

      const answer = await exchangeRaw(
        socket,
        [
          `GET http://127.0.0.1:${app.port}/ HTTP/1.1`,
          `Host: 127.0.0.1:${app.port}`,
          "Connection: Upgrade, HTTP2-Settings",
          "Upgrade: h2c",
          "HTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA",
          "",
          "",
        ].join("\r\n"),
      )

      expect(answer).toMatch(/^HTTP\/1\.1 200 [\s\S]*plain none$/)
    } finally {
      close(app.server)
    }
  })

  it("counts messages split across frames and chunks, and reads a masked close code", () => {
    const counter = new FrameCounter()
    const mask = Buffer.from([1, 2, 3, 4])
    const masked = (payload: Buffer) =>
      Buffer.from(payload.map((byte, i) => byte ^ (mask[i % 4] ?? 0)))
    const frames = Buffer.concat([
      /* "hel" not final, then a ping in between, then "lo" final. */
      Buffer.from([0x01, 0x83]),
      mask,
      masked(Buffer.from("hel")),
      Buffer.from([0x89, 0x80]),
      mask,
      Buffer.from([0x80, 0x82]),
      mask,
      masked(Buffer.from("lo")),
      /* A 300-byte binary message, with a 16-bit length. */
      Buffer.from([0x82, 0xfe, 0x01, 0x2c]),
      mask,
      masked(Buffer.alloc(300, 7)),
      /* Close 1001. */
      Buffer.from([0x88, 0x82]),
      mask,
      masked(Buffer.from([0x03, 0xe9])),
    ])

    for (let at = 0; at < frames.length; at += 3) counter.push(frames.subarray(at, at + 3))

    expect(counter).toMatchObject({ messages: 2, bytes: 305, closeCode: 1001 })
  })
})
