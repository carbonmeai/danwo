/**
 * HTTP/2 through the proxy, client and servers under the test's hand: a client that offers HTTP/2
 * alone, over TLS in a CONNECT tunnel or in cleartext from its first byte, answered by a route's
 * handler or passed on to a real HTTP/2 or HTTP/1.1 server, with streaming, trailers, resets and
 * faults on one stream at a time.
 */
import { once } from "node:events"
import {
  type ClientHttp2Session,
  type ClientHttp2Stream,
  connect as connectH2,
  constants,
  createSecureServer,
  createServer as createH2cServer,
  type Http2SecureServer,
  type Http2Server,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type ServerHttp2Stream,
} from "node:http2"
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https"
import { connect, type Socket } from "node:net"
import { connect as tlsConnect, type TLSSocket } from "node:tls"

import { listeningPort } from "@danwo/emulators"
import { afterEach, describe, expect, it } from "vitest"

import { createAuthority } from "../src/authority.ts"
import { chosenProtocol } from "../src/listener.ts"
import { type Handler, type Proxy, type ProxyOptions, startProxy } from "../src/proxy.ts"

let proxies: Proxy[] = []
let cleanups: (() => void)[] = []

async function proxyFor(options: ProxyOptions): Promise<Proxy> {
  const proxy = await startProxy(options)

  proxies.push(proxy)

  return proxy
}

afterEach(async () => {
  for (const cleanup of cleanups) cleanup()
  cleanups = []
  await Promise.all(proxies.map((proxy) => proxy.stop()))
  proxies = []
})

function proxyPort(proxy: Proxy): number {
  return Number(new URL(proxy.url).port)
}

/** A CONNECT tunnel to `target` through the proxy, once the proxy said 200. */
async function tunnel(proxy: Proxy, target: string): Promise<Socket> {
  const socket = connect(proxyPort(proxy), "127.0.0.1")

  await once(socket, "connect")
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)

  const [first]: unknown[] = await once(socket, "data")

  expect(String(first)).toMatch(/^HTTP\/1\.1 200 /)

  return socket
}

/** TLS through a tunnel to `target`, offering `protocols` and trusting the proxy's CA alone. */
async function secureTunnel(proxy: Proxy, target: string, protocols: string[]): Promise<TLSSocket> {
  const socket = await tunnel(proxy, target)
  const secure = tlsConnect({
    socket,
    ca: proxy.caCert,
    servername: target.split(":")[0] ?? "",
    ALPNProtocols: protocols,
  })

  secure.on("error", () => {})
  await once(secure, "secureConnect")

  return secure
}

/** An HTTP/2 session to `target` that offers only HTTP/2, through a tunnel and TLS. */
async function h2Session(proxy: Proxy, target: string): Promise<ClientHttp2Session> {
  const secure = await secureTunnel(proxy, target, ["h2"])

  expect(secure.alpnProtocol).toBe("h2")

  const session = connectH2(`https://${target}`, { createConnection: () => secure })

  session.on("error", () => {})
  cleanups.push(() => session.destroy())

  return session
}

/** An HTTP/2 session in cleartext, from the first byte: through a tunnel to `target`, or not. */
async function h2cSession(proxy: Proxy, target?: string): Promise<ClientHttp2Session> {
  const socket = target === undefined ? undefined : await tunnel(proxy, target)
  const session = connectH2(target === undefined ? proxy.url : `http://${target}`, {
    ...(socket && { createConnection: () => socket }),
  })

  session.on("error", () => {})
  cleanups.push(() => session.destroy())

  return session
}

interface Answer {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: string
  readonly trailers: IncomingHttpHeaders | undefined
  /** Whether the stream ended with its headers. */
  readonly endedWithHeaders: boolean
}

/** Reads a stream's whole answer; rejects with the stream's error, such as a reset. */
function answerOf(stream: ClientHttp2Stream): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let headers: IncomingHttpHeaders = {}
    let trailers: IncomingHttpHeaders | undefined
    let body = ""
    let endedWithHeaders = false

    stream.setEncoding("utf8")
    stream.on("response", (head, flags) => {
      headers = head
      endedWithHeaders = (flags & constants.NGHTTP2_FLAG_END_STREAM) !== 0
    })
    stream.on("trailers", (fields) => {
      trailers = fields
    })
    stream.on("data", (chunk: string) => {
      body += chunk
    })
    stream.on("error", reject)
    stream.on("end", () =>
      resolve({
        status: Number(headers[":status"]),
        headers,
        body,
        trailers,
        endedWithHeaders,
      }),
    )
  })
}

function request(
  session: ClientHttp2Session,
  headers: OutgoingHttpHeaders,
  body?: string,
): Promise<Answer> {
  const stream = session.request(headers, { endStream: body === undefined })

  if (body !== undefined) stream.end(body)

  return answerOf(stream)
}

/** The code a stream was reset with, once it closes. */
async function resetCode(stream: ClientHttp2Stream): Promise<number | undefined> {
  stream.on("error", () => {})
  stream.resume()
  /* Not `once()`, which rejects on the reset's error. */
  await new Promise((resolve) => stream.once("close", resolve))

  return stream.rstCode
}

/** A route whose handler says what it was asked, and the requests it saw. */
function echoRoute(): { handler: Handler; seen: Request[] } {
  const seen: Request[] = []

  const handler: Handler = async (req) => {
    seen.push(req)

    return Response.json(
      {
        method: req.method,
        url: req.url,
        body: await req.text(),
        cookie: req.headers.get("cookie"),
      },
      { headers: { "x-handled": "yes" } },
    )
  }

  return { handler, seen }
}

/** A certificate authority's context for `host`, for a test server. */
async function contextOf(host: string) {
  return (await createAuthority("a local dev CA")).contextFor(host)
}

/** An HTTPS HTTP/2 server on 127.0.0.1 (for `localhost`) that answers each stream through `answer`. */
async function h2Upstream(
  answer: (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => void,
): Promise<{ server: Http2SecureServer; port: number; sessions: () => number }> {
  const context = await contextOf("localhost")
  const server = createSecureServer({
    SNICallback: (_name, done) => done(null, context),
  })
  let sessions = 0

  server.on("session", () => {
    sessions += 1
  })
  server.on("stream", (stream, headers) => {
    stream.on("error", () => {})
    answer(stream, headers)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  cleanups.push(() => server.close())

  return { server, port: listeningPort(server), sessions: () => sessions }
}

describe("protocol", () => {
  it("speaks HTTP/1.1 to a client that offers it alongside HTTP/2, and HTTP/2 to one that offers HTTP/2 alone", async () => {
    expect(chosenProtocol(["h2", "http/1.1"])).toBe("http/1.1")
    expect(chosenProtocol(["http/1.1", "h2"])).toBe("http/1.1")
    expect(chosenProtocol(["h2"])).toBe("h2")
    expect(chosenProtocol(["spdy/3"])).toBeUndefined()

    const proxy = await proxyFor({ routes: [] })
    const browser = await secureTunnel(proxy, "api.danwo.test:443", ["h2", "http/1.1"])

    expect(browser.alpnProtocol).toBe("http/1.1")
    browser.destroy()

    const grpc = await secureTunnel(proxy, "api.danwo.test:443", ["h2"])

    expect(grpc.alpnProtocol).toBe("h2")
    grpc.destroy()
  })
})

describe("routed HTTP/2 streams", () => {
  it("answers GET and POST from a route's handler, on one session, and records each", async () => {
    const route = echoRoute()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: route.handler }],
    })
    const session = await h2Session(proxy, "api.danwo.test:443")
    const [got, posted] = await Promise.all([
      request(session, { ":path": "/hello?x=1", cookie: ["a=1", "b=2"] }),
      request(
        session,
        { ":method": "POST", ":path": "/items", "content-type": "application/json" },
        '{"name":"cup"}',
      ),
    ])

    expect(got.status).toBe(200)
    expect(got.headers["x-handled"]).toBe("yes")
    expect(JSON.parse(got.body)).toEqual({
      method: "GET",
      url: "https://api.danwo.test/hello?x=1",
      body: "",
      cookie: "a=1; b=2",
    })
    expect(JSON.parse(posted.body)).toMatchObject({ method: "POST", body: '{"name":"cup"}' })

    await proxy.settled()

    const exchanges = proxy.exchanges()

    expect(exchanges.map((e) => [e.method, e.host, e.path, e.status, e.disposition])).toEqual(
      expect.arrayContaining([
        ["GET", "api.danwo.test", "/hello?x=1", 200, "routed"],
        ["POST", "api.danwo.test", "/items", 200, "routed"],
      ]),
    )
    expect(exchanges.find((e) => e.method === "POST")?.request?.body).toBe('{"name":"cup"}')
    expect(exchanges.find((e) => e.method === "GET")?.response?.headers["x-handled"]).toBe("yes")
  })

  it("sends a handler's gRPC status after its messages, as trailers, and alone with its headers when there are none", async () => {
    const proxy = await proxyFor({
      routes: [
        {
          hosts: ["grpc.danwo.test"],
          handler: async (req) =>
            new URL(req.url).pathname === "/ok"
              ? new Response(new Uint8Array([0, 0, 0, 0, 1, 7]), {
                  headers: { "content-type": "application/grpc", "grpc-status": "0" },
                })
              : new Response(null, {
                  headers: {
                    "content-type": "application/grpc",
                    "grpc-status": "5",
                    "grpc-message": "missing",
                  },
                }),
        },
      ],
    })
    const session = await h2Session(proxy, "grpc.danwo.test:443")
    const ok = await request(session, { ":method": "POST", ":path": "/ok" }, "")
    const missing = await request(session, { ":method": "POST", ":path": "/missing" }, "")

    expect(ok.headers["grpc-status"]).toBeUndefined()
    expect(ok.trailers?.["grpc-status"]).toBe("0")
    expect(missing.endedWithHeaders).toBe(true)
    expect(missing.headers["grpc-status"]).toBe("5")
    expect(missing.headers["grpc-message"]).toBe("missing")
  })

  it("answers cleartext HTTP/2 from its first byte, in a tunnel and sent straight to the proxy", async () => {
    const route = echoRoute()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: route.handler }],
    })
    const tunnelled = await h2cSession(proxy, "api.danwo.test:8080")
    const direct = await h2cSession(proxy)

    expect(JSON.parse((await request(tunnelled, { ":path": "/in" })).body).url).toBe(
      "http://api.danwo.test:8080/in",
    )
    expect(
      JSON.parse(
        (await request(direct, { ":path": "/straight", ":authority": "api.danwo.test" })).body,
      ).url,
    ).toBe("http://api.danwo.test/straight")
  })

  it("refuses a blocked host, and a host no route answers under unmatched: block", async () => {
    const proxy = await proxyFor({
      routes: [],
      unmatched: "block",
      blocked: ["ads.danwo.test"],
    })
    const blocked = await request(await h2Session(proxy, "ads.danwo.test:443"), { ":path": "/" })
    const unrouted = await request(await h2Session(proxy, "else.danwo.test:443"), { ":path": "/" })

    expect(blocked.status).toBe(502)
    expect(blocked.body).toBe("danwo proxy: host is blocked for this run")
    expect(unrouted.status).toBe(502)
    await proxy.settled()
    expect(proxy.exchanges().map((e) => e.disposition)).toEqual(["blocked", "blocked"])
  })
})

describe("faults on HTTP/2 streams", () => {
  it("answers a status fault without reaching the handler", async () => {
    const route = echoRoute()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: route.handler }],
    })

    proxy.setFault(() => ({ kind: "status", status: 503, body: '{"error":"down"}' }))

    const session = await h2Session(proxy, "api.danwo.test:443")
    const answer = await request(session, { ":path": "/charge" })

    expect(answer.status).toBe(503)
    expect(answer.body).toBe('{"error":"down"}')
    expect(route.seen).toHaveLength(0)
    await proxy.settled()
    expect(proxy.exchanges()[0]?.fault).toBe("status 503")
  })

  it("resets one stream, and another on the same session still gets its answer", async () => {
    const route = echoRoute()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: route.handler }],
    })

    proxy.failNext((call) => call.path === "/fail", { kind: "reset" })

    const session = await h2Session(proxy, "api.danwo.test:443")
    const failing = session.request({ ":path": "/fail" })
    const [code, other] = await Promise.all([
      resetCode(failing),
      request(session, { ":path": "/fine" }),
    ])

    expect(code).toBe(constants.NGHTTP2_INTERNAL_ERROR)
    expect(other.status).toBe(200)
    expect(route.seen.map((req) => new URL(req.url).pathname)).toEqual(["/fine"])
    expect(session.closed || session.destroyed).toBe(false)
    expect((await request(session, { ":path": "/after" })).status).toBe(200)

    await proxy.settled()

    const failed = proxy.exchanges().find((e) => e.path === "/fail")

    expect(failed).toMatchObject({ fault: "reset", aborted: true, status: null })
  })

  it("lets the handler act on a reset-after stream, then resets it", async () => {
    const route = echoRoute()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: route.handler }],
    })

    proxy.failNext(() => true, { kind: "reset-after" })

    const session = await h2Session(proxy, "api.danwo.test:443")
    const stream = session.request({ ":method": "POST", ":path": "/emails" })

    stream.end("{}")

    expect(await resetCode(stream)).toBe(constants.NGHTTP2_INTERNAL_ERROR)
    expect(route.seen).toHaveLength(1)
  })

  it("holds a delayed stream back while others answer", async () => {
    const route = echoRoute()
    const proxy = await proxyFor({
      routes: [{ hosts: ["api.danwo.test"], handler: route.handler }],
    })

    proxy.failNext((call) => call.path === "/slow", { kind: "delay", ms: 300 })

    const session = await h2Session(proxy, "api.danwo.test:443")
    const finished: string[] = []
    const slow = request(session, { ":path": "/slow" }).then(() => finished.push("slow"))
    const quick = request(session, { ":path": "/quick" }).then(() => finished.push("quick"))

    await Promise.all([slow, quick])
    expect(finished).toEqual(["quick", "slow"])
  })
})

describe("HTTP/2 passthrough", () => {
  it("passes streams on to an HTTP/2 server over one session, streaming both ways, with trailers", async () => {
    const seen: IncomingHttpHeaders[] = []
    const upstream = await h2Upstream((stream, headers) => {
      seen.push(headers)
      stream.respond(
        { ":status": 200, "content-type": "application/grpc" },
        { waitForTrailers: true },
      )
      stream.on("wantTrailers", () =>
        stream.sendTrailers({ "grpc-status": "0", "grpc-message": "all good" }),
      )
      /* Echoes each piece as it arrives, so the client sees one answer before it sends the next. */
      stream.on("data", (chunk: Buffer) => stream.write(`echo:${chunk.toString()};`))
      stream.on("end", () => stream.end())
    })
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${upstream.port}`)
    const stream = session.request({
      ":method": "POST",
      ":path": "/chat.Chat/Talk",
      "content-type": "application/grpc",
      te: "trailers",
    })
    const answer = answerOf(stream)
    const echoes: string[] = []

    stream.on("data", (chunk: Buffer | string) => echoes.push(String(chunk)))
    stream.write("one")
    await expect.poll(() => echoes.join("")).toBe("echo:one;")
    stream.write("two")
    await expect.poll(() => echoes.join("")).toBe("echo:one;echo:two;")
    stream.end()

    const done = await answer

    expect(done.status).toBe(200)
    expect(done.trailers).toMatchObject({ "grpc-status": "0", "grpc-message": "all good" })

    const second = await request(session, { ":method": "POST", ":path": "/again" }, "three")

    expect(second.body).toBe("echo:three;")
    expect(upstream.sessions()).toBe(1)
    expect(seen[0]).toMatchObject({
      ":method": "POST",
      ":path": "/chat.Chat/Talk",
      ":scheme": "https",
      ":authority": `localhost:${upstream.port}`,
      te: "trailers",
    })

    await proxy.settled()

    const exchange = proxy.exchanges().find((e) => e.path === "/chat.Chat/Talk")

    expect(exchange).toMatchObject({ disposition: "passthrough", status: 200, stream: true })
    expect(exchange?.request?.bytes).toBe("onetwo".length)
  })

  it("ends a trailers-only answer with its headers, and resets the client's stream with the server's code", async () => {
    const upstream = await h2Upstream((stream, headers) => {
      if (headers[":path"] === "/reset") {
        stream.close(constants.NGHTTP2_ENHANCE_YOUR_CALM)

        return
      }

      stream.respond(
        { ":status": 200, "content-type": "application/grpc", "grpc-status": "5" },
        { endStream: true },
      )
    })
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${upstream.port}`)
    const failed = await request(session, { ":method": "POST", ":path": "/missing" }, "")

    expect(failed.endedWithHeaders).toBe(true)
    expect(failed.headers["grpc-status"]).toBe("5")
    expect(await resetCode(session.request({ ":path": "/reset" }))).toBe(
      constants.NGHTTP2_ENHANCE_YOUR_CALM,
    )
  })

  it("cancels the stream at the server when the client resets it", async () => {
    const closed: number[] = []
    const upstream = await h2Upstream((stream) => {
      stream.respond({ ":status": 200 })
      stream.write("first")
      stream.on("close", () => closed.push(stream.rstCode))
    })
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${upstream.port}`)
    const stream = session.request({ ":path": "/feed" })

    await once(stream, "data")
    stream.close(constants.NGHTTP2_CANCEL)

    await expect.poll(() => closed).toEqual([constants.NGHTTP2_CANCEL])
  })

  it("passes streams on over HTTP/1.1 to a server that speaks only that, trailers included", async () => {
    const context = await contextOf("localhost")
    const server: HttpsServer = createHttpsServer(
      { SNICallback: (_name, done) => done(null, context) },
      (req, res) => {
        const chunks: Buffer[] = []

        req.on("data", (chunk: Buffer) => chunks.push(chunk))
        req.on("end", () => {
          res.writeHead(200, {
            "content-type": "text/plain",
            trailer: "x-sum",
            connection: "keep-alive",
          })
          res.write(`${req.httpVersion} ${req.headers.host} ${Buffer.concat(chunks).toString()}`)
          res.addTrailers({ "x-sum": "42" })
          res.end()
        })
      },
    )

    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    cleanups.push(() => {
      server.closeAllConnections()
      server.close()
    })

    const port = listeningPort(server)
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${port}`)
    const answer = await request(session, { ":method": "POST", ":path": "/old" }, "hi")

    expect(answer.status).toBe(200)
    expect(answer.body).toBe(`1.1 localhost:${port} hi`)
    expect(answer.headers.connection).toBeUndefined()
    expect(answer.trailers?.["x-sum"]).toBe("42")
  })

  it("passes cleartext HTTP/2 on to a cleartext HTTP/2 server", async () => {
    const server: Http2Server = createH2cServer()

    server.on("stream", (stream, headers) => {
      stream.respond({ ":status": 200 }, { waitForTrailers: true })
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-done": "yes" }))
      stream.end(`plain ${String(headers[":authority"])}`)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    cleanups.push(() => server.close())

    const port = listeningPort(server)
    const proxy = await proxyFor({ routes: [] })
    const session = await h2cSession(proxy, `127.0.0.1:${port}`)
    const answer = await request(session, { ":path": "/" })

    expect(answer.body).toBe(`plain 127.0.0.1:${port}`)
    expect(answer.trailers?.["x-done"]).toBe("yes")
  })

  it("sends a stream the server refused once more, body and all, and passes a second refusal on", async () => {
    let streams = 0
    const upstream = await h2Upstream((stream, headers) => {
      streams += 1

      if (headers[":path"] === "/always" || streams === 1) {
        stream.close(constants.NGHTTP2_REFUSED_STREAM)

        return
      }

      const chunks: Buffer[] = []

      stream.on("data", (chunk: Buffer) => chunks.push(chunk))
      stream.on("end", () => {
        stream.respond({ ":status": 200 })
        stream.end(`got ${Buffer.concat(chunks).toString()}`)
      })
    })
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${upstream.port}`)
    const answer = await request(session, { ":method": "POST", ":path": "/once" }, "the body")

    expect(answer.body).toBe("got the body")
    expect(streams).toBe(2)

    const always = session.request({ ":method": "POST", ":path": "/always" })

    always.end("again")
    expect(await resetCode(always)).toBe(constants.NGHTTP2_REFUSED_STREAM)
    expect(streams).toBe(4)
  })

  it("opens a fresh session when the server closed the pooled one between calls", async () => {
    const upstream = await h2Upstream((stream) => {
      stream.respond({ ":status": 200 })
      stream.end("fine")
      /* As a server closes a connection it holds idle. */
      stream.session?.close()
    })
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${upstream.port}`)

    expect((await request(session, { ":path": "/one" })).body).toBe("fine")
    expect((await request(session, { ":path": "/two" })).body).toBe("fine")
    expect(upstream.sessions()).toBe(2)
  })

  it("does not send a refused stream again once its body is too big to keep", async () => {
    let streams = 0
    const upstream = await h2Upstream((stream) => {
      streams += 1
      stream.on("data", () => {})
      stream.on("end", () => stream.close(constants.NGHTTP2_REFUSED_STREAM))
    })
    const proxy = await proxyFor({ routes: [] })
    const session = await h2Session(proxy, `localhost:${upstream.port}`)
    const big = session.request({ ":method": "POST", ":path": "/upload" })

    big.end(Buffer.alloc(2 * 1024 * 1024, 1))
    expect(await resetCode(big)).toBe(constants.NGHTTP2_REFUSED_STREAM)
    expect(streams).toBe(1)
  })

  it("refuses a stream addressed to the proxy itself, rather than forwarding it to itself", async () => {
    const proxy = await proxyFor({ routes: [] })
    const session = await h2cSession(proxy, `127.0.0.1:${proxyPort(proxy)}`)
    const answer = await request(session, { ":path": "/" })

    expect(answer.status).toBe(502)
    expect(answer.body).toMatch(/is the proxy itself/)
  })
})
