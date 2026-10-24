/**
 * The proxy's front door: one port on 127.0.0.1 that takes plain HTTP proxy requests
 * (`GET http://host/path`), CONNECT tunnels, and TLS, and turns each request into an
 * {@link Incoming} that says where the client meant it to go.
 *
 * Every connection's first byte says what it carries: `0x16` opens a TLS handshake, which the
 * proxy answers as the host the client asked for, with a certificate from its authority; anything
 * else is HTTP. After a CONNECT the same test runs on what comes through the tunnel, so a tunnel
 * may carry TLS (HTTPS, WSS) or plain HTTP (an agent that tunnels `http://` too). The proxy speaks
 * HTTP/1.1 to clients: TLS offers `http/1.1` through ALPN, and a client that offers HTTP/2 alone is
 * turned away in the handshake, with the alert that says so, rather than left to fail later.
 */
import { randomUUID } from "node:crypto"
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  ServerResponse,
} from "node:http"
import { createServer as createNetServer, isIP, type Server as NetServer, Socket } from "node:net"
import type { Duplex } from "node:stream"
import { TLSSocket } from "node:tls"

import { type Authority, normalHost } from "./authority.ts"
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
  readonly message: IncomingMessage
  readonly connection: Connection
  /** Epoch milliseconds when the request arrived. */
  readonly startedAt: number
  /** `performance.now()` when it arrived, for its duration. */
  readonly startTime: number
  /**
   * True for a request Node handed over as an upgrade that the proxy answers as an ordinary request
   * (an `Upgrade: h2c`): its body, if it has one, is not read.
   */
  readonly bodyless?: boolean
}

export interface ListenerHandlers {
  request(incoming: Incoming, response: ServerResponse): void
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
      message,
      connection,
      startedAt: Date.now(),
      startTime: performance.now(),
    }
  )
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

  /** Hands a socket's next bytes to TLS or to HTTP, by its first byte. */
  const sniff = async (socket: Duplex, connection: Connection): Promise<void> => {
    socket.on("error", (error) => debug(`client connection: ${error.message}`))

    const first = await peek(socket)

    if (first === null || socket.destroyed) return

    if (first[0] === 0x16) await terminateTls(socket, connection)
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
      ALPNCallback: ({ protocols }) => http1Protocol(protocols),
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
      connections.set(tls, { ...connection, encrypted: true })
      http.emit("connection", tls)
    })
  }

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
