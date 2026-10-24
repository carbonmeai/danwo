/**
 * The proxy's front door: one port on 127.0.0.1 that takes plain HTTP proxy requests
 * (`GET http://host/path`), CONNECT tunnels, and TLS, and turns each request into an
 * {@link Incoming} that says where the client meant it to go.
 *
 * Every connection's first byte says what it carries: `0x16` opens a TLS handshake, which the
 * proxy answers as the host the client asked for, with a certificate from its authority; anything
 * else is HTTP. After a CONNECT the same test runs on what comes through the tunnel, so a tunnel
 * may carry TLS (HTTPS, WSS) or plain HTTP (an agent that tunnels `http://` too).
 *
 * The proxy speaks HTTP/1.1 to a client that offers it through ALPN, as browsers and most SDKs do
 * alongside HTTP/2, and HTTP/2 to one that offers HTTP/2 alone (gRPC). Plain HTTP/2 without TLS
 * (`h2c`) is taken from a client that opens with the HTTP/2 preface, as gRPC does to a plaintext
 * target. Each HTTP/2 stream becomes an {@link Incoming} like any HTTP/1.1 request.
 */
import { randomUUID } from "node:crypto"
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  ServerResponse,
} from "node:http"
import {
  createServer as createH2Server,
  type Http2Session,
  type IncomingHttpHeaders,
  type ServerHttp2Stream,
} from "node:http2"
import { createServer as createNetServer, isIP, type Server as NetServer, Socket } from "node:net"
import type { Duplex } from "node:stream"
import { TLSSocket } from "node:tls"

import { type Authority, normalHost } from "./authority.ts"
import { h2Pairs, H2Response, isH2Preface } from "./h2.ts"
import { httpSocketUrl } from "./socket-urls.ts"

/** Where a request goes: the host as the client named it (normalised), and the port. */
export interface Destination {
  readonly hostname: string
  readonly port: number
}

/** What the proxy knows about one connection a request arrived on. */
export interface Connection {
  /** The client's TCP connection to the proxy, under any TLS and tunnels. */
  readonly raw: Socket
  /** Where the CONNECT tunnel this connection is inside leads, if it is inside one. */
  readonly tunnel?: Destination
  /** True once the proxy has taken TLS off it: what comes through was sent as HTTPS. */
  readonly encrypted: boolean
}

/** One request, with where its client meant it to go. */
export interface Incoming {
  /** Unique within the proxy's run. */
  readonly id: string
  readonly method: string
  readonly protocol: "http" | "https"
  readonly destination: Destination
  /** The absolute URL the client asked for, with an `http:` or `https:` scheme. */
  readonly url: string
  /** Path and query, as the client sent them. */
  readonly path: string
  /** Headers by lower-case name, repeated ones as arrays; the proxy's own `Proxy-*` ones removed. */
  readonly headers: Readonly<Record<string, string | readonly string[]>>
  /** The same headers as the client wrote them, name then value, in order and in their own case. */
  readonly rawHeaders: readonly string[]
  /** `1.1` (or `1.0`) for an HTTP/1.x request; `2` for an HTTP/2 stream. */
  readonly httpVersion: "1.0" | "1.1" | "2"
  /** The request's body as it arrives: an HTTP/1.x message, or the HTTP/2 stream's readable side. */
  readonly message: IncomingMessage | ServerHttp2Stream
  /** The trailers that ended the body, name then value, once it has ended. */
  readonly trailers: () => readonly string[]
  readonly connection: Connection
  /** Epoch milliseconds when the request arrived. */
  readonly startedAt: number
  /** `performance.now()` when it arrived, for its duration. */
  readonly startTime: number
  /**
   * True for a request with no body to read: one Node handed over as an upgrade that the proxy
   * answers as an ordinary request (an `Upgrade: h2c`), whose body, if it has one, is not read, or
   * an HTTP/2 stream that ended with its headers.
   */
  readonly bodyless?: boolean
}

export interface ListenerHandlers {
  /** A request, answered through `response`: an HTTP/1.x response, or an HTTP/2 stream's. */
  request(incoming: Incoming, response: ServerResponse | H2Response): void
  /** A WebSocket handshake; `head` holds whatever the client sent after its headers. */
  upgrade(incoming: Incoming, socket: Duplex, head: Buffer): void
}

export interface Listener {
  readonly port: number
  /** Drops `socket`'s connection with a TCP reset, so its client sees `ECONNRESET`. */
  reset(socket: Duplex): void
  /** What the proxy knows about the connection `socket` belongs to. */
  connectionOf(socket: Duplex): Connection | undefined
  close(): Promise<void>
}

/** How long a client may take over its TLS handshake before the proxy gives up on it. */
const HANDSHAKE_TIMEOUT_MS = 30_000
/**
 * How long an idle keep-alive connection stays open. Longer than the usual client's own idle
 * timeout, so the client closes first: a request sent just as the server closes would be lost.
 */
const KEEP_ALIVE_TIMEOUT_MS = 65_000

/** Request headers up to this size are taken (Node's default, 16 KiB, turns big cookies away). */
export const MAX_HEADER_BYTES = 64 * 1024

/** The `http/1.x` protocol a client offers through ALPN, or undefined when it offers none. */
export function http1Protocol(offered: readonly string[]): string | undefined {
  /* `http 1.1` is not standard, but some proxy agents send it. */
  return ["http/1.1", "http 1.1", "http/1.0"].find((protocol) => offered.includes(protocol))
}

/**
 * The protocol the proxy picks from a client's ALPN offer: HTTP/1.x whenever it is offered, so a
 * client that offers HTTP/2 too is answered as before, else HTTP/2. Undefined for an offer of
 * neither, which the handshake turns away with the alert that says so.
 */
export function chosenProtocol(offered: readonly string[]): string | undefined {
  return http1Protocol(offered) ?? (offered.includes("h2") ? "h2" : undefined)
}

/** An authority's host and port text, without any `user@`; an IPv6 host comes without brackets. */
function splitAuthority(authority: string): { host: string; port: string } | undefined {
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1)
  const parts =
    /^\[(?<host>[^\]]+)\](?::(?<port>\d*))?$/.exec(hostPort) ??
    /^(?<host>[^:]*)(?::(?<port>\d*))?$/.exec(hostPort)
  const host = parts?.groups?.["host"] ?? ""

  return host === "" ? undefined : { host, port: parts?.groups?.["port"] ?? "" }
}

/** `host` or `host:port` (with `[v6]` brackets) as a destination; undefined when it is not one. */
export function parseAuthority(authority: string, defaultPort: number): Destination | undefined {
  const parts = splitAuthority(authority)
  const port = parts?.port === "" ? defaultPort : Number(parts?.port)

  if (parts === undefined || !Number.isInteger(port) || port <= 0 || port > 65_535) return undefined

  return { hostname: normalHost(parts.host), port }
}

/** `hostname` as it goes in a URL: an IPv6 address in brackets. */
function urlHost(hostname: string): string {
  return isIP(hostname) === 6 ? `[${hostname}]` : hostname
}

/** The `host[:port]` of a URL, the port left out when it is the scheme's own. */
function urlAuthority(protocol: "http" | "https", destination: Destination): string {
  const standard = protocol === "https" ? 443 : 80

  return destination.port === standard
    ? urlHost(destination.hostname)
    : `${urlHost(destination.hostname)}:${destination.port}`
}

const ABSOLUTE = /^([a-z][a-z\d+.-]*):\/\/([^/?#]*)(.*)$/is

/** Headers that tell the proxy something about itself, and are not passed on. */
const PROXY_HEADERS = new Set(["proxy-connection", "proxy-authorization"])

function headerRecord(raw: readonly string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}

  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = (raw[i] ?? "").toLowerCase()
    const value = raw[i + 1] ?? ""
    const seen = out[name]

    out[name] = seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
  }

  return out
}

function firstValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}

/** The parts of an {@link Incoming} that say where it goes. */
type Placed = Pick<Incoming, "protocol" | "destination" | "path" | "url">

/** Where an absolute-form request goes: the host and path its URL names. */
function placeAbsolute(match: RegExpExecArray): Placed | undefined {
  const scheme = (match[1] ?? "").toLowerCase()

  if (scheme !== "http" && scheme !== "https") return undefined

  const destination = parseAuthority(match[2] ?? "", scheme === "https" ? 443 : 80)
  const rest = match[3] ?? ""
  const path = rest.startsWith("/") ? rest : `/${rest}`

  return (
    destination && {
      protocol: scheme,
      destination,
      path,
      url: `${scheme}://${urlAuthority(scheme, destination)}${path}`,
    }
  )
}

/**
 * Where an origin-form request goes: through its tunnel, else to its `Host`. A tunnel to an
 * address takes its URL's name from `Host`, but still goes to the address.
 */
function placeOrigin(
  path: string,
  host: string | undefined,
  connection: Connection,
): Placed | undefined {
  const protocol = connection.encrypted ? "https" : "http"
  const fromHost = parseAuthority(host ?? "", protocol === "https" ? 443 : 80)
  const { tunnel } = connection
  const destination = tunnel ?? fromHost

  if (destination === undefined) return undefined

  const named =
    tunnel !== undefined && isIP(tunnel.hostname) !== 0 && fromHost !== undefined
      ? { hostname: fromHost.hostname, port: destination.port }
      : destination

  return {
    protocol,
    destination,
    path,
    url: `${protocol}://${urlAuthority(protocol, named)}${path}`,
  }
}

/**
 * Where `message` was meant to go. An absolute URL (`GET http://host/path`, or WebKit's
 * `GET ws://host/path` for a socket) names it; otherwise the tunnel it came through does, then its
 * `Host` header. Undefined when nothing names a destination.
 */
function incomingOf(message: IncomingMessage, connection: Connection): Incoming | undefined {
  const rawHeaders = message.rawHeaders.filter(
    (_value, index, all) => !PROXY_HEADERS.has((all[index - (index % 2)] ?? "").toLowerCase()),
  )
  const headers = headerRecord(rawHeaders)
  const target = message.url ?? "/"
  const absolute = ABSOLUTE.exec(httpSocketUrl(target))
  const placed = absolute
    ? placeAbsolute(absolute)
    : placeOrigin(target, firstValue(headers.host), connection)

  return (
    placed && {
      ...placed,
      id: randomUUID(),
      method: message.method ?? "GET",
      headers,
      rawHeaders,
      httpVersion: message.httpVersion === "1.0" ? "1.0" : "1.1",
      message,
      trailers: () => message.rawTrailers,
      connection,
      startedAt: Date.now(),
      startTime: performance.now(),
    }
  )
}

/** `pairs` with every `Cookie` joined into the first, as HTTP/1.1 and handlers expect one. */
function joinedCookies(pairs: readonly [string, string][]): [string, string][] {
  const cookies = pairs.filter(([name]) => name === "cookie").map(([, value]) => value)

  if (cookies.length < 2) return [...pairs]

  const first = pairs.findIndex(([name]) => name === "cookie")

  return pairs.flatMap(([name, value], index): [string, string][] => {
    if (name !== "cookie") return [[name, value]]

    return index === first ? [["cookie", cookies.join("; ")]] : []
  })
}

/**
 * Where an HTTP/2 stream was meant to go. Inside a tunnel or TLS, the connection names it as it
 * does an origin-form request, with `:authority` in place of `Host`; on a bare cleartext
 * connection to the proxy, `:scheme` and `:authority` name it as an absolute URL does.
 */
function placeStream(headers: IncomingHttpHeaders, connection: Connection): Placed | undefined {
  const path = firstValue(headers[":path"]) ?? "/"
  const authority = firstValue(headers[":authority"]) ?? firstValue(headers.host)
  const bare = connection.tunnel === undefined && !connection.encrypted

  if (!bare || authority === undefined) return placeOrigin(path, authority, connection)

  const absolute = ABSOLUTE.exec(
    `${firstValue(headers[":scheme"]) ?? "http"}://${authority}${path}`,
  )

  return absolute ? placeAbsolute(absolute) : undefined
}

/** An HTTP/2 stream as a request: its own headers, without pseudo-headers, and where it goes. */
function streamIncomingOf(
  stream: ServerHttp2Stream,
  headers: IncomingHttpHeaders,
  connection: Connection,
): Incoming | undefined {
  const pairs = joinedCookies(
    h2Pairs(headers).filter(([name]) => !PROXY_HEADERS.has(name) && name !== "host"),
  )
  const rawHeaders = pairs.flat()
  const placed = placeStream(headers, connection)
  const trailers: string[] = []

  stream.once("trailers", (fields: IncomingHttpHeaders) => trailers.push(...h2Pairs(fields).flat()))

  return (
    placed && {
      ...placed,
      id: randomUUID(),
      method: firstValue(headers[":method"]) ?? "GET",
      headers: headerRecord(rawHeaders),
      rawHeaders,
      httpVersion: "2",
      message: stream,
      trailers: () => trailers,
      connection,
      startedAt: Date.now(),
      startTime: performance.now(),
      ...(stream.endAfterHeaders && { bodyless: true }),
    }
  )
}

/** A short plain-text answer on an HTTP/2 stream, which then ends. */
function streamAnswer(stream: ServerHttp2Stream, status: number, body: string): void {
  if (stream.destroyed || stream.headersSent) return
  stream.respond({ ":status": status, "content-type": "text/plain" })
  stream.end(body)
}

/** The first chunk a socket sends, put back for whoever reads it next; null when it ends first. */
function peek(socket: Duplex): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const read = () => {
      const chunk: unknown = socket.read()

      if (chunk === null) return

      cleanup()

      const data = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(typeof chunk === "string" ? chunk : "")

      socket.unshift(data)
      resolve(data)
    }

    const ended = () => {
      cleanup()
      resolve(null)
    }

    const cleanup = () => {
      socket.off("readable", read)
      socket.off("end", ended)
      socket.off("close", ended)
    }

    socket.on("readable", read)
    socket.once("end", ended)
    socket.once("close", ended)
    read()
  })
}

/** A short plain-text answer written straight to a socket, which then closes. */
export function rawAnswer(status: number, reason: string, body: string): string {
  return [
    `HTTP/1.1 ${status} ${reason}`,
    "Connection: close",
    "Content-Type: text/plain",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n")
}

/** Destroys a socket with a TCP reset where it can, else plainly. */
function resetSocket(socket: Socket): void {
  try {
    socket.resetAndDestroy()
  } catch {
    socket.destroy()
  }
}

/** Starts the listener on 127.0.0.1, on a free port. */
export async function startListener(
  authority: Authority,
  handlers: ListenerHandlers,
  debug: (message: string) => void = () => {},
): Promise<Listener> {
  const connections = new WeakMap<Duplex, Connection>()
  const open = new Set<Socket>()

  const http: HttpServer = createHttpServer({
    requireHostHeader: false,
    maxHeaderSize: MAX_HEADER_BYTES,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
  })
  const h2 = createH2Server({ settings: { maxHeaderListSize: MAX_HEADER_BYTES } })
  /** The connection each HTTP/2 session runs on, which its streams' requests arrived on. */
  const sessions = new WeakMap<Http2Session, Connection>()

  /** Starts an HTTP/2 session on `socket`; Node makes it, and says so, as the connection goes in. */
  const serveH2 = (socket: Duplex, connection: Connection): void => {
    h2.once("session", (session: Http2Session) => sessions.set(session, connection))
    h2.emit("connection", socket)
  }

  /** Hands a socket's next bytes to TLS or to HTTP, by its first byte. */
  const sniff = async (socket: Duplex, connection: Connection): Promise<void> => {
    socket.on("error", (error) => debug(`client connection: ${error.message}`))

    const first = await peek(socket)

    if (first === null || socket.destroyed) return

    if (first[0] === 0x16) await terminateTls(socket, connection)
    else if (isH2Preface(first)) serveH2(socket, connection)
    else {
      connections.set(socket, connection)
      http.emit("connection", socket)
    }
  }

  /**
   * Answers a TLS handshake as the host the client asked for: the name it sent (SNI), else the
   * tunnel's host (an address, which clients send no name for), with that host's certificate.
   */
  const terminateTls = async (socket: Duplex, connection: Connection): Promise<void> => {
    const fallback = connection.tunnel?.hostname ?? "localhost"
    const context = await authority.contextFor(fallback).catch((error: unknown) => {
      debug(`certificate for ${fallback}: ${String(error)}`)

      return undefined
    })

    if (context === undefined || socket.destroyed) {
      socket.destroy()

      return
    }

    if (socket instanceof Socket) socket.allowHalfOpen = false

    const tls = new TLSSocket(socket, {
      isServer: true,
      secureContext: context,
      SNICallback: (servername, done) => {
        authority.contextFor(servername).then(
          (found) => done(null, found),
          (error: unknown) => done(error instanceof Error ? error : new Error(String(error))),
        )
      },
      ALPNCallback: ({ protocols }) => chosenProtocol(protocols),
    })
    const timer = setTimeout(() => tls.destroy(), HANDSHAKE_TIMEOUT_MS)

    timer.unref()
    tls.on("error", (error) => {
      clearTimeout(timer)
      debug(`TLS with a client for ${fallback}: ${error.message}`)
      tls.destroy()
    })
    tls.once("close", () => clearTimeout(timer))
    tls.once("secure", () => {
      clearTimeout(timer)

      const secured = { ...connection, encrypted: true }

      if (tls.alpnProtocol === "h2") {
        /*
         * An HTTP/2 session waits for its socket's handshake while `secureConnecting` says it is
         * under way, which only a TLS server's own sockets are told is over: this one is said so.
         */
        Reflect.set(tls, "secureConnecting", false)
        serveH2(tls, secured)

        return
      }

      connections.set(tls, secured)
      http.emit("connection", tls)
    })
  }

  h2.on("sessionError", (error: Error) => debug(`HTTP/2 client session: ${error.message}`))
  h2.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    const connection = stream.session && sessions.get(stream.session)

    stream.on("error", (error) => debug(`HTTP/2 client stream: ${error.message}`))

    if (connection === undefined) {
      streamAnswer(stream, 500, "")

      return
    }

    if (headers[":method"] === "CONNECT") {
      streamAnswer(stream, 501, "danwo proxy: no CONNECT over HTTP/2")

      return
    }

    const incoming = streamIncomingOf(stream, headers, connection)

    if (incoming === undefined) {
      streamAnswer(stream, 400, "danwo proxy: this request names no host to go to")

      return
    }

    /* The body follows at once, whatever the client asked to wait for. */
    if (headers.expect?.toLowerCase() === "100-continue")
      stream.additionalHeaders({ ":status": 100 })
    handlers.request(incoming, new H2Response(stream))
  })

  http.on("request", (message: IncomingMessage, response: ServerResponse) => {
    const connection = connections.get(message.socket)

    if (connection === undefined) {
      response.writeHead(500).end()

      return
    }

    const incoming = incomingOf(message, connection)

    if (incoming === undefined) {
      response
        .writeHead(400, { "content-type": "text/plain" })
        .end("danwo proxy: this request names no host to go to")

      return
    }

    handlers.request(incoming, response)
  })

  /* An `Expect` other than `100-continue`: answered like any request, rather than with a 417. */
  http.on("checkExpectation", (message: IncomingMessage, response: ServerResponse) =>
    http.emit("request", message, response),
  )

  http.on("connect", (message: IncomingMessage, socket: Duplex, head: Buffer) => {
    const outer = connections.get(socket)
    const tunnel = parseAuthority(message.url ?? "", 443)

    socket.on("error", (error) => debug(`tunnel: ${error.message}`))

    if (outer === undefined || tunnel === undefined) {
      socket.end(rawAnswer(400, "Bad Request", "danwo proxy: CONNECT names no host and port"))

      return
    }

    const version = message.httpVersion === "1.0" ? "1.0" : "1.1"

    socket.write(`HTTP/${version} 200 Connection established\r\n\r\n`)
    if (head.length > 0) socket.unshift(head)
    /* What comes through the tunnel is as the client sent it, until the proxy takes TLS off it. */
    void sniff(socket, { raw: outer.raw, tunnel, encrypted: false })
  })

  http.on("upgrade", (message: IncomingMessage, socket: Duplex, head: Buffer) => {
    const connection = connections.get(socket)
    const incoming = connection && incomingOf(message, connection)
    const upgrade = firstValue(message.headers.upgrade)?.toLowerCase()

    socket.on("error", (error) => debug(`upgrade: ${error.message}`))

    if (incoming === undefined) {
      socket.end(rawAnswer(400, "Bad Request", "danwo proxy: this request names no host to go to"))

      return
    }

    if (upgrade === "websocket") {
      handlers.upgrade(incoming, socket, head)

      return
    }

    /*
     * Any other upgrade (`h2c`) is not taken: the request is answered as an ordinary one, on a
     * connection that then closes, as a server that does not speak the protocol would answer it.
     */
    if (!(socket instanceof Socket)) {
      socket.end(rawAnswer(501, "Not Implemented", `danwo proxy: no ${upgrade ?? ""} upgrades`))

      return
    }

    const response = new ServerResponse(message)

    response.assignSocket(socket)
    response.shouldKeepAlive = false
    response.once("finish", () => socket.end())
    handlers.request({ ...incoming, bodyless: true }, response)
  })

  const server: NetServer = createNetServer({ noDelay: true }, (socket) => {
    open.add(socket)
    socket.once("close", () => open.delete(socket))

    void sniff(socket, { raw: socket, encrypted: false })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return {
    port,
    reset(socket) {
      const raw = connections.get(socket)?.raw ?? (socket instanceof Socket ? socket : undefined)

      if (raw === undefined) socket.destroy()
      else resetSocket(raw)
    },
    connectionOf: (socket) => connections.get(socket),
    async close() {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))

      for (const socket of open) socket.destroy()
      open.clear()
      http.closeAllConnections()
      await closed
    },
  }
}
