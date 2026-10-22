/**
 * The TCP side of a data proxy: it accepts the app's connections, opens one to the real server
 * for each, and hands the bytes both ways to a protocol session that can read, hold, drop or
 * answer them. Faults that take the server away for a while are kept here, since they outlive
 * the connection they started on.
 */
import { once } from "node:events"
import { connect, createServer, type Server, type Socket } from "node:net"

import { describeDataFault } from "./faults.ts"
import { type CallHandle, Ledger } from "./ledger.ts"
import type { DataCallStart, DataFault, DataFaultRule, DataKind, DataProxy } from "./types.ts"

/** How a session talks to both ends of its connection. */
export interface Wire {
  toServer(bytes: Buffer): void
  toClient(bytes: Buffer): void
  /** Drops the connection on both sides. */
  kill(): void
}

/** What a session may ask of the proxy around it. */
export interface SessionContext {
  /** Which client connection this is, from 1. */
  readonly connection: number
  readonly service: string
  /** Records a call as sent with the fault picked for it, and returns a handle to settle it. */
  begin(start: Omit<DataCallStart, "service" | "connection" | "kind">): {
    readonly fault: DataFault | undefined
    readonly handle: CallHandle
  }
  /** Turns new connections away for `ms`, the way `fault` says. */
  goDown(fault: Extract<DataFault, { kind: "down" }>): void
}

/** One connection's protocol logic: bytes from either end, and the end of the line. */
export interface Session {
  fromClient(bytes: Buffer): void
  fromServer(bytes: Buffer): void
  /** The connection is gone: pending calls never got an answer. */
  closed(): void
}

/** A wire protocol a data proxy speaks. */
export interface Protocol {
  readonly kind: DataKind
  session(wire: Wire, context: SessionContext): Session
  /** Answers a connection made while the server is down as too full, e.g. Postgres 53300. */
  turnAway?(socket: Socket): void
}

export interface Upstream {
  readonly host: string
  readonly port: number
}

/** The upstream's host and port from a URL (`postgres://…@host:5432/db`) or an address. */
export function upstreamOf(upstream: string | Upstream, defaultPort: number): Upstream {
  if (typeof upstream !== "string") return upstream

  const url = new URL(upstream)

  return { host: url.hostname || "127.0.0.1", port: Number(url.port || defaultPort) }
}

interface Pair {
  readonly client: Socket
  readonly server: Socket | undefined
  readonly session: Session | undefined
}

interface DownWindow {
  readonly until: number
  readonly refuse: "close" | "too-many-connections"
}

/** The label a call's fault gets in its record: what the fault is, on what. */
function faultLabel(fault: DataFault, start: DataCallStart): string {
  return `${describeDataFault(fault)} on ${start.operation} (${start.service})`
}

class TcpDataProxy implements DataProxy {
  readonly ledger = new Ledger()
  readonly pairs = new Set<Pair>()
  rule: DataFaultRule | undefined
  down: DownWindow | undefined
  connections = 0
  port = 0

  readonly protocol: Protocol
  readonly upstream: Upstream
  readonly service: string
  readonly server: Server
  readonly host: string

  constructor(options: StartOptions, server: Server, host: string) {
    this.protocol = options.protocol
    this.upstream = options.upstream
    this.service = options.service
    this.server = server
    this.host = host
  }

  get kind(): DataKind {
    return this.protocol.kind
  }

  url(upstreamUrl: string): string {
    const url = new URL(upstreamUrl)

    url.hostname = this.host
    url.port = String(this.port)

    return url.toString()
  }

  calls() {
    return this.ledger.calls()
  }

  setFault(rule?: DataFaultRule): void {
    this.rule = rule
    if (rule === undefined) this.down = undefined
  }

  clear(): void {
    this.ledger.clear()
    this.rule = undefined
    this.down = undefined
  }

  dropConnections(): void {
    for (const pair of this.pairs) this.drop(pair)
  }

  async close(): Promise<void> {
    this.dropConnections()
    this.server.close()
  }

  /** What becomes of a new connection while the server is down: refused, turned away, or neither. */
  downNow(): DownWindow | undefined {
    if (this.down !== undefined && Date.now() >= this.down.until) this.down = undefined

    return this.down
  }

  accept(client: Socket): void {
    const connection = ++this.connections
    const down = this.downNow()

    client.on("error", () => undefined)
    if (down !== undefined) return this.refuse(client, down)

    /*
     * A session writes each frame as it is read, so one query can go out as several small writes.
     * With Nagle's algorithm on, each write after the first waits for the peer's delayed ACK (40 ms
     * on Linux), and a transaction of five statements took a fifth of a second through the proxy.
     */
    client.setNoDelay(true)
    const server = connect({ port: this.upstream.port, host: this.upstream.host, noDelay: true })
    const pair: { client: Socket; server: Socket; session: Session | undefined } = {
      client,
      server,
      session: undefined,
    }
    const wire: Wire = {
      toServer: (bytes) => void (server.destroyed || server.write(bytes)),
      toClient: (bytes) => void (client.destroyed || client.write(bytes)),
      kill: () => this.drop(pair),
    }

    pair.session = this.protocol.session(wire, this.context(connection))
    this.pairs.add(pair)
    server.on("error", () => this.drop(pair))
    client.on("data", (bytes: Buffer) => pair.session?.fromClient(bytes))
    server.on("data", (bytes: Buffer) => pair.session?.fromServer(bytes))
    client.on("close", () => this.drop(pair))
    server.on("close", () => this.drop(pair))
  }

  refuse(client: Socket, down: DownWindow): void {
    if (down.refuse === "too-many-connections" && this.protocol.turnAway !== undefined)
      return this.protocol.turnAway(client)

    client.destroy()
  }

  drop(pair: Pair): void {
    if (!this.pairs.delete(pair)) return

    pair.client.destroy()
    pair.server?.destroy()
    pair.session?.closed()
  }

  context(connection: number): SessionContext {
    return {
      connection,
      service: this.service,
      begin: (partial) => {
        const start: DataCallStart = {
          ...partial,
          service: this.service,
          kind: this.kind,
          connection,
        }
        const fault = this.rule?.(start)
        const label = fault === undefined ? null : faultLabel(fault, start)

        return { fault, handle: this.ledger.begin(start, fault, label) }
      },
      goDown: (fault) => {
        this.down = { until: Date.now() + fault.ms, refuse: fault.refuse ?? "close" }
      },
    }
  }
}

export interface StartOptions {
  readonly protocol: Protocol
  readonly upstream: Upstream
  /** The proxy's name in calls and fault labels. */
  readonly service: string
  /** Port to listen on (default: a free one), on 127.0.0.1. */
  readonly port?: number
}

/** Starts a data proxy in front of `upstream`, listening on 127.0.0.1. */
export async function startTcpDataProxy(options: StartOptions): Promise<DataProxy> {
  const host = "127.0.0.1"
  const server = createServer()
  const proxy = new TcpDataProxy(options, server, host)

  server.on("connection", (client) => proxy.accept(client))
  server.listen(options.port ?? 0, host)
  await once(server, "listening")

  const address = server.address()

  proxy.port = typeof address === "object" && address !== null ? address.port : 0

  return proxy
}
