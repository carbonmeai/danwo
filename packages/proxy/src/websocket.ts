/**
 * WebSockets through the proxy: upgrades to this machine and to passthrough hosts go on to their
 * destination, upgrades to a routed host go to its WebSocket upstream when it has one, and blocked
 * hosts are refused cleanly. Each connection is logged with its frame counts and sizes (never the
 * frames themselves), and a fault rule can refuse an upgrade or drop the connection.
 */
import type { CompletedRequest, Mockttp } from "mockttp"

import { clientOf, userField } from "./clients.ts"

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
  /** Frames the client sent, and their total size in bytes. */
  readonly fromClient: { frames: number; bytes: number }
  /** Frames the client received, and their total size in bytes. */
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
const REASONS = ["fault", "blocked", "unserved"] as const

/** The status a refused upgrade gets for each reason, and the body it says why with. */
const REFUSED: Readonly<Record<(typeof REASONS)[number], readonly [number, string]>> = {
  fault: [503, "danwo proxy: WebSocket refused by a fault"],
  blocked: [403, "danwo proxy: WebSocket host is blocked for this run"],
  unserved: [501, "danwo proxy: this host's emulator does not serve WebSockets"],
}

/** Where one upgrade goes: refused for a reason, forwarded to an upstream, or let through. */
type Decision =
  | { readonly kind: "refuse"; readonly reason: keyof typeof REFUSED }
  | { readonly kind: "reset" }
  | { readonly kind: "forward"; readonly upstream: string }
  | { readonly kind: "through" }

/** The proxy's WebSockets: the rules that place them, and the log of every connection. */
export interface Sockets {
  sockets(): readonly SocketExchange[]
  setFault(rule: SocketFaultRule | undefined): void
  clear(): void
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

/** Registers the WebSocket rules on `server` and starts logging connections. */
export async function handleSockets(
  server: Mockttp,
  hosts: SocketHosts,
  upstreams: readonly SocketUpstream[],
): Promise<Sockets> {
  const log = new Map<string, SocketExchange>()
  const decided = new Map<string, Decision>()
  let faultRule: SocketFaultRule | undefined
  let index = 0

  const decide = (req: CompletedRequest): Decision => {
    const known = decided.get(req.id)

    if (known) return known

    const host = req.destination.hostname
    const placed = placement(hosts, host)
    const call = { host, path: req.path, ...userField(req.headers["user-agent"]) }
    const fault = placed.kind === "refuse" ? undefined : faultRule?.({ ...call, index: index++ })
    const decision: Decision =
      fault === undefined
        ? placed
        : fault.kind === "reset"
          ? { kind: "reset" }
          : { kind: "refuse", reason: "fault" }

    decided.set(req.id, decision)

    return decision
  }

  for (const reason of REASONS) {
    const [status, body] = REFUSED[reason]

    await server
      .forAnyWebSocket()
      .matching((req) => {
        const decision = decide(req)

        return decision.kind === "refuse" && decision.reason === reason
      })
      .always()
      .thenRejectConnection(status, undefined, { "content-type": "text/plain" }, body)
  }

  await server
    .forAnyWebSocket()
    .matching((req) => decide(req).kind === "reset")
    .always()
    .thenResetConnection()

  for (const route of upstreams) {
    await server
      .forAnyWebSocket()
      .matching((req) => decide(req).kind === "forward" && route.matches(req.destination.hostname))
      .always()
      .thenForwardTo(route.upstream)
  }

  await server
    .forAnyWebSocket()
    .matching((req) => decide(req).kind === "through")
    .always()
    .thenPassThrough()

  await server.on("websocket-request", (req) => {
    const host = req.destination.hostname
    const decision = decide(req)

    log.set(req.id, {
      id: req.id,
      disposition: dispositionOf(hosts, host),
      host,
      path: req.path,
      startedAt: new Date(req.timingEvents.startTime).toISOString(),
      client: clientOf(req.headers["user-agent"]),
      ...userField(req.headers["user-agent"]),
      fault:
        decision.kind === "reset"
          ? "ws reset"
          : decision.kind === "refuse" && decision.reason === "fault"
            ? "ws refuse"
            : null,
      status: decision.kind === "refuse" ? REFUSED[decision.reason][0] : null,
      closedAt: null,
      closeCode: null,
      aborted: false,
      fromClient: { frames: 0, bytes: 0 },
      toClient: { frames: 0, bytes: 0 },
    })
  })
  await server.on("websocket-accepted", (res) => {
    const socket = log.get(res.id)

    if (socket) socket.status = res.statusCode
  })
  await server.on("websocket-message-received", (message) => {
    const counts = log.get(message.streamId)?.fromClient

    if (counts) {
      counts.frames++
      counts.bytes += message.content.byteLength
    }
  })
  await server.on("websocket-message-sent", (message) => {
    const counts = log.get(message.streamId)?.toClient

    if (counts) {
      counts.frames++
      counts.bytes += message.content.byteLength
    }
  })
  await server.on("websocket-close", (close) => {
    const socket = log.get(close.streamId)

    if (socket) {
      socket.closedAt = new Date().toISOString()
      socket.closeCode = close.closeCode ?? null
    }
  })
  await server.on("abort", (req) => {
    const socket = log.get(req.id)

    if (socket && socket.closedAt === null) {
      socket.aborted = true
      socket.closedAt = new Date().toISOString()
    }
  })

  return {
    sockets: () => [...log.values()],
    setFault(rule) {
      faultRule = rule
    },
    clear() {
      log.clear()
      decided.clear()
      index = 0
    },
  }
}
