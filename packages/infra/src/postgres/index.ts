/** A data proxy that speaks the Postgres wire protocol. */
import type { Socket } from "node:net"

import { POSTGRES_ERRORS } from "../faults.ts"
import { type Protocol, startTcpDataProxy, type Upstream, upstreamOf } from "../tcp.ts"
import type { DataProxy } from "../types.ts"
import { errorResponse, Framer, GSSENC_REQUEST, SSL_REQUEST } from "./frames.ts"
import { PostgresSession } from "./session.ts"

/**
 * Answers a connection made while the database is "full": it declines TLS, reads the startup
 * message, and replies with the FATAL error a server at `max_connections` gives.
 */
function turnAway(socket: Socket): void {
  const framer = new Framer(false)

  socket.on("data", (bytes: Buffer) => {
    framer.feed(bytes)

    for (let message = framer.next(); message !== undefined; message = framer.next()) {
      const code = message.body.length >= 4 ? message.body.readInt32BE(0) : 0

      if (code === SSL_REQUEST || code === GSSENC_REQUEST) {
        socket.write("N")
        continue
      }

      const { code: sqlstate, message: text } = POSTGRES_ERRORS.too_many_connections

      socket.end(errorResponse("FATAL", sqlstate, text))

      return
    }
  })
}

const POSTGRES: Protocol = {
  kind: "postgres",
  session: (wire, context) => new PostgresSession(wire, context),
  turnAway,
}

export interface PostgresProxyOptions {
  /** The real database: its URL (`postgres://user:pass@host:5432/db`) or host and port. */
  readonly upstream: string | Upstream
  /** The proxy's name in calls and fault labels (default `postgres`). */
  readonly service?: string
  readonly port?: number
}

/**
 * Starts a proxy in front of a Postgres server. Point the app at `proxy.url(databaseUrl)`
 * instead of the database; every statement it sends is then recorded and can be faulted. TLS
 * between the app and the database is declined, so the app must allow a plain connection
 * (`sslmode=disable` or `prefer`, the default for most drivers).
 */
export function startPostgresProxy(options: PostgresProxyOptions): Promise<DataProxy> {
  return startTcpDataProxy({
    protocol: POSTGRES,
    upstream: upstreamOf(options.upstream, 5432),
    service: options.service ?? "postgres",
    ...(options.port !== undefined && { port: options.port }),
  })
}
