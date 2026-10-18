/** A data proxy that speaks the Redis protocol (RESP2 and RESP3). */
import { type Protocol, startTcpDataProxy, type Upstream, upstreamOf } from "../tcp.ts"
import type { DataProxy } from "../types.ts"
import { RedisSession } from "./session.ts"

const REDIS: Protocol = {
  kind: "redis",
  session: (wire, context) => new RedisSession(wire, context),
}

export interface RedisProxyOptions {
  /** The real server: its URL (`redis://host:6379/0`) or host and port. */
  readonly upstream: string | Upstream
  /** The proxy's name in calls and fault labels (default `redis`). */
  readonly service?: string
  readonly port?: number
}

/**
 * Starts a proxy in front of a Redis server. Point the app at `proxy.url(redisUrl)` instead of
 * the server; every command it sends is then recorded and can be faulted. TLS (`rediss://`) is
 * not supported through the proxy.
 */
export function startRedisProxy(options: RedisProxyOptions): Promise<DataProxy> {
  return startTcpDataProxy({
    protocol: REDIS,
    upstream: upstreamOf(options.upstream, 6379),
    service: options.service ?? "redis",
    ...(options.port !== undefined && { port: options.port }),
  })
}
