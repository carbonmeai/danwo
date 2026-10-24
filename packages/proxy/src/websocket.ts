/**
 * WebSockets through the proxy: upgrades to this machine and to passthrough hosts go on to their
 * destination, upgrades to a routed host go to its WebSocket upstream when it has one, and blocked
 * hosts are refused cleanly. Each connection is logged with its message counts and sizes (never the
 * messages themselves), and a fault rule can refuse an upgrade or drop the connection.
 *
 * A socket that goes through is not re-encoded: the proxy makes the handshake to the far end with
 * the client's own headers, hands the far end's answer back as it came, then passes bytes both
 * ways, reading the frames as they pass. Whatever the two ends agree on (subprotocols, compression)
 * stays between them.
 */
import { request as httpRequest, type IncomingMessage, STATUS_CODES } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP, type Socket } from "node:net"
import type { Duplex } from "node:stream"

import { clientOf, userField } from "./clients.ts"
import { FrameCounter } from "./frames.ts"
import { isLoopback } from "./hosts.ts"
import { type Destination, type Incoming, parseAuthority, rawAnswer } from "./listener.ts"
import { dialAddress, endToEnd, type Upstreams } from "./passthrough.ts"
import { pairsOf } from "./reply.ts"

/** One WebSocket connection through the proxy, for the flight recorder. */
export interface SocketExchange {
  readonly id: string
  /** Answered by a route's upstream, passed to the real host (or this machine), or refused. */
  readonly disposition: "routed" | "passthrough" | "blocked"
  readonly host: string
  /** Path and query of the upgrade request. */
  readonly path: string
  readonly startedAt: string
  readonly client: "browser" | "server"
  /** The person whose browser opened it, in a test that opened more than one person's browser. */
  readonly user?: string
  /** The fault injected into this connection, if any. */
  fault: string | null
  /** 101 once the upgrade is accepted, the refusal's status, or null while it is pending. */
  status: number | null
  closedAt: string | null
  /** The close frame's code, when it closed cleanly. */
  closeCode: number | null
  /** True when it ended without a close frame (dropped, reset, or the run stopped). */
  aborted: boolean
  /** Messages the client sent, and their total size in bytes. */
  readonly fromClient: { frames: number; bytes: number }
  /** Messages the client received, and their total size in bytes. */
  readonly toClient: { frames: number; bytes: number }
}

/** An upgrade, as a fault rule sees it: the host and path, numbered among this run's sockets. */
export interface SocketCall {
  readonly host: string
  readonly path: string
  readonly index: number
  /** The person whose browser opens it, when the test opened more than one person's browser. */
  readonly user?: string
}

/**
 * What to do to one WebSocket instead of letting it through: `refuse` answers the upgrade with
 * 503, so the client never connects; `reset` drops the connection during the upgrade.
 */
export type SocketFault = { readonly kind: "refuse" } | { readonly kind: "reset" }

export type SocketFaultRule = (call: SocketCall) => SocketFault | undefined

/** What the proxy knows about a host when a socket opens to it. */
export interface SocketHosts {
  readonly isRouted: (host: string) => boolean
  /** The `ws://` or `wss://` endpoint a routed host's sockets go to, if it serves any. */
  readonly upstreamOf: (host: string) => string | undefined
  readonly isBlocked: (host: string) => boolean
  readonly isAllowed: (host: string) => boolean
  readonly unmatched: "passthrough" | "block"
}

/** Why an upgrade is refused: a fault, a blocked host, or a routed host that serves no sockets. */
type Reason = "fault" | "blocked" | "unserved"

/** The status a refused upgrade gets for each reason, and the body it says why with. */
const REFUSED: Readonly<Record<Reason, readonly [number, string]>> = {
  fault: [503, "danwo proxy: WebSocket refused by a fault"],
  blocked: [403, "danwo proxy: WebSocket host is blocked for this run"],
  unserved: [501, "danwo proxy: this host's emulator does not serve WebSockets"],
}

/** Where one upgrade goes: refused for a reason, forwarded to an upstream, or let through. */
type Decision =
  | { readonly kind: "refuse"; readonly reason: Reason }
  | { readonly kind: "reset" }
  | { readonly kind: "forward"; readonly upstream: string }
  | { readonly kind: "through" }

/** The proxy's WebSockets: the rules that place them, and the log of every connection. */
export interface Sockets {
  sockets(): readonly SocketExchange[]
  setFault(rule: SocketFaultRule | undefined): void
  clear(): void
  /** Takes one upgrade the proxy received. */
  handle(incoming: Incoming, socket: Duplex, head: Buffer): void
}

/** Where a socket to `host` goes when no fault applies. */
function placement(hosts: SocketHosts, host: string): Decision {
  if (hosts.isRouted(host)) {
    const upstream = hosts.upstreamOf(host)

    return upstream === undefined
      ? { kind: "refuse", reason: "unserved" }
      : { kind: "forward", upstream }
  }

  /* This machine, unless a `blocked` entry names it, and the `allow` list. */
  if (hosts.isAllowed(host)) return { kind: "through" }
  if (hosts.isBlocked(host) || hosts.unmatched === "block")
    return { kind: "refuse", reason: "blocked" }

  return { kind: "through" }
}

function dispositionOf(hosts: SocketHosts, host: string): SocketExchange["disposition"] {
  const placed = placement(hosts, host)

  if (placed.kind === "forward" || hosts.isRouted(host)) return "routed"

  return placed.kind === "refuse" ? "blocked" : "passthrough"
}

/** A routed host pattern whose sockets go to `upstream`. */
export interface SocketUpstream {
  readonly matches: (host: string) => boolean
  readonly upstream: string
}

/** What the WebSocket handling needs from the rest of the proxy. */
export interface SocketPlumbing {
  readonly upstreams: Upstreams
  /** Drops a client's connection with a TCP reset. */
  reset(socket: Duplex): void
  debug(message: string): void
}

/** Where a socket that goes through is sent: the host, port and scheme, and the `Host` it names. */
interface Target {
  readonly destination: Destination
  readonly secure: boolean
  /** Replaces the client's `Host` header, for a socket forwarded to a route's upstream. */
  readonly host?: string
}

function targetOf(decision: Decision, incoming: Incoming): Target | undefined {
  if (decision.kind === "through")
    return { destination: incoming.destination, secure: incoming.protocol === "https" }
  if (decision.kind !== "forward") return undefined

  if (!URL.canParse(decision.upstream)) return undefined

  const url = new URL(decision.upstream)
  const secure = url.protocol === "wss:" || url.protocol === "https:"
  const destination = parseAuthority(url.host, secure ? 443 : 80)

  return destination && { destination, secure, host: url.host }
}

/** The handshake's headers for the far end: the client's own, minus the proxy's hop-by-hop ones. */
function handshakeHeaders(incoming: Incoming, target: Target): string[] {
  const pairs = endToEnd(pairsOf(incoming.rawHeaders)).filter(
    ([name]) => target.host === undefined || name.toLowerCase() !== "host",
  )

  if (target.host !== undefined) pairs.unshift(["Host", target.host])
  else if (!pairs.some(([name]) => name.toLowerCase() === "host"))
    pairs.unshift(["Host", incoming.destination.hostname])

  return [...pairs.flat(), "Connection", "Upgrade", "Upgrade", "websocket"]
}

/** The far end's answer to a handshake, as the bytes of its status line and headers. */
function answerHead(answer: IncomingMessage): string {
  const lines = [`HTTP/1.1 ${answer.statusCode ?? 502} ${answer.statusMessage ?? ""}`]

  for (const [name, value] of pairsOf(answer.rawHeaders)) lines.push(`${name}: ${value}`)

  return `${lines.join("\r\n")}\r\n\r\n`
}

/** The fault label a decision puts on its socket's record. */
function faultLabel(decision: Decision): string | null {
  if (decision.kind === "reset") return "ws reset"

  return decision.kind === "refuse" && decision.reason === "fault" ? "ws refuse" : null
}

/** The record of a socket as it opens. */
function socketRecord(hosts: SocketHosts, incoming: Incoming, decision: Decision): SocketExchange {
  const host = incoming.destination.hostname

  return {
    id: incoming.id,
    disposition: dispositionOf(hosts, host),
    host,
    path: incoming.path,
    startedAt: new Date(incoming.startedAt).toISOString(),
    client: clientOf(incoming.headers["user-agent"]),
    ...userField(incoming.headers["user-agent"]),
    fault: faultLabel(decision),
    status: decision.kind === "refuse" ? REFUSED[decision.reason][0] : null,
    closedAt: null,
    closeCode: null,
    aborted: false,
    fromClient: { frames: 0, bytes: 0 },
    toClient: { frames: 0, bytes: 0 },
  }
}

/** Creates the proxy's WebSocket handling, with an empty log. */
export function createSockets(hosts: SocketHosts, plumbing: SocketPlumbing): Sockets {
  const log = new Map<string, SocketExchange>()
  let faultRule: SocketFaultRule | undefined
  let index = 0

  const decide = (incoming: Incoming): Decision => {
    const host = incoming.destination.hostname
    const placed = placement(hosts, host)
    const call = { host, path: incoming.path, ...userField(incoming.headers["user-agent"]) }
    const fault = placed.kind === "refuse" ? undefined : faultRule?.({ ...call, index: index++ })

    if (fault === undefined) return placed

    return fault.kind === "reset" ? { kind: "reset" } : { kind: "refuse", reason: "fault" }
  }

  /** Marks a socket closed, and aborted when no close frame passed. */
  const closed = (exchange: SocketExchange, closeCode: number | null | undefined) => {
    if (exchange.closedAt !== null) return
    exchange.closedAt = new Date().toISOString()
    exchange.closeCode = closeCode ?? null
    if (closeCode === undefined) exchange.aborted = true
  }

  /** Passes bytes both ways once the far end has accepted, counting the messages in each. */
  const bridge = (exchange: SocketExchange, client: Duplex, far: Socket) => {
    const sent = new FrameCounter()
    const received = new FrameCounter()

    const sync = () => {
      exchange.fromClient.frames = sent.messages
      exchange.fromClient.bytes = sent.bytes
      exchange.toClient.frames = received.messages
      exchange.toClient.bytes = received.bytes
    }

    let open = 2

    const end = () => {
      open -= 1
      client.destroy()
      far.destroy()
      if (open > 0) return

      const codes = [sent.closeCode, received.closeCode].filter((code) => code !== undefined)

      sync()
      closed(
        exchange,
        codes.length === 0 ? undefined : (codes.find((code) => code !== null) ?? null),
      )
    }

    client.on("data", (chunk: Buffer) => {
      sent.push(chunk)
      sync()
    })
    far.on("data", (chunk: Buffer) => {
      received.push(chunk)
      sync()
    })
    client.pipe(far)
    far.pipe(client)
    client.once("close", end)
    far.once("close", end)
    far.on("error", (error) => plumbing.debug(`WebSocket to ${exchange.host}: ${error.message}`))
  }

  /** Makes the handshake with `target` and, once it accepts, joins the two ends. */
  const connect = (
    exchange: SocketExchange,
    incoming: Incoming,
    target: Target,
    client: Duplex,
    head: Buffer,
  ) => {
    const { destination, secure } = target

    void dialAddress(destination.hostname, destination.port).then((dial) => {
      const upstream = (secure ? httpsRequest : httpRequest)({
        host: dial,
        port: destination.port,
        method: "GET",
        path: incoming.path,
        headers: handshakeHeaders(incoming, target),
        setHost: false,
        agent: false,
        ...(secure && {
          ...(isIP(destination.hostname) === 0 && { servername: destination.hostname }),
          rejectUnauthorized: !isLoopback(destination.hostname),
        }),
      })

      upstream.on("socket", (socket: Socket) => plumbing.upstreams.own.track(socket))
      upstream.on("upgrade", (answer: IncomingMessage, far: Socket, farHead: Buffer) => {
        exchange.status = answer.statusCode ?? 101
        plumbing.upstreams.own.track(far)

        if (client.destroyed) {
          far.destroy()
          closed(exchange, undefined)

          return
        }

        client.write(answerHead(answer))
        if (farHead.length > 0) far.unshift(farHead)
        bridge(exchange, client, far)
        if (head.length > 0) far.write(head)
      })
      /* The far end turned the handshake down: its answer goes back to the client as it came. */
      upstream.on("response", (answer: IncomingMessage) => {
        exchange.status = answer.statusCode ?? null
        client.write(answerHead(answer))
        answer.pipe(client)
        answer.once("end", () => client.end())
      })
      upstream.on("error", (error: Error) => {
        plumbing.debug(`WebSocket handshake with ${destination.hostname}: ${error.message}`)
        if (exchange.status === null && !client.destroyed) {
          exchange.status = 502
          client.end(
            rawAnswer(
              502,
              "Bad Gateway",
              `danwo proxy: could not reach ${destination.hostname}:${destination.port} (${error.message})`,
            ),
          )
        } else client.destroy()
      })
      client.once("close", () => {
        if (exchange.status === null) {
          upstream.destroy()
          closed(exchange, undefined)
        }
      })
      upstream.end()
    })
  }

  return {
    sockets: () => [...log.values()],
    setFault(rule) {
      faultRule = rule
    },
    clear() {
      log.clear()
      index = 0
    },
    handle(incoming, socket, head) {
      const decision = decide(incoming)
      const exchange = socketRecord(hosts, incoming, decision)

      log.set(exchange.id, exchange)

      if (decision.kind === "refuse") {
        const [status, body] = REFUSED[decision.reason]

        socket.end(rawAnswer(status, STATUS_CODES[status] ?? "Refused", body))

        return
      }

      if (decision.kind === "reset") {
        plumbing.reset(socket)
        closed(exchange, undefined)

        return
      }

      const target = targetOf(decision, incoming)
      const looped =
        target !== undefined &&
        decision.kind === "through" &&
        plumbing.upstreams.isLoop(target.destination, incoming.connection.raw)

      if (target === undefined || looped) {
        exchange.status = 502
        socket.end(
          rawAnswer(
            502,
            "Bad Gateway",
            looped
              ? "danwo proxy: this socket is addressed to the proxy itself"
              : "danwo proxy: this route's WebSocket URL is not one",
          ),
        )

        return
      }

      connect(exchange, incoming, target, socket, head)
    },
  }
}
