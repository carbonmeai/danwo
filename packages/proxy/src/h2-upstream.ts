/**
 * HTTP/2 sessions to the hosts the proxy passes HTTP/2 streams on to, one per origin, shared by
 * every stream to it. Over TLS the host picks the protocol through ALPN: one that answers HTTP/1.1
 * is remembered as such, and its streams pass on over HTTP/1.1 instead. Without TLS, a client that
 * spoke HTTP/2 from its first byte knew its server does, so the proxy does the same.
 */
import { once } from "node:events"
import { type ClientHttp2Session, connect as connectH2 } from "node:http2"
import { connect as connectTcp, isIP } from "node:net"
import { connect as connectTls } from "node:tls"

import { isLoopback } from "./hosts.ts"
import type { OwnConnections } from "./loop.ts"

/** How long a session with no streams stays open before the proxy closes it. */
const IDLE_MS = 60_000

/** Where a session goes: the host as named, the address dialled, and whether it is over TLS. */
export interface H2Target {
  readonly hostname: string
  readonly port: number
  readonly dial: string
  readonly secure: boolean
}

function hostInUrl(hostname: string): string {
  return isIP(hostname) === 6 ? `[${hostname}]` : hostname
}

export class H2Sessions {
  readonly #own: OwnConnections
  readonly #sessions = new Map<string, Promise<ClientHttp2Session | undefined>>()
  /** Origins that answered HTTP/1.1 when offered HTTP/2. */
  readonly #http1 = new Set<string>()
  readonly #open = new Set<ClientHttp2Session>()

  constructor(own: OwnConnections) {
    this.#own = own
  }

  /**
   * The session to `target`, opened the first time it is asked for; undefined when the host
   * answers HTTP/1.1 only, or could not be reached (the caller passes the stream on over HTTP/1.1,
   * which reports why).
   */
  async sessionFor(target: H2Target): Promise<ClientHttp2Session | undefined> {
    const key = `${target.secure ? "https" : "http"}://${target.hostname}:${target.port}@${target.dial}`

    const pending = this.#sessions.get(key)
    const known = pending && (await pending)

    if (known && !known.closed && !known.destroyed) return known
    if (this.#http1.has(key)) return undefined

    const opening = this.#start(key, target)

    this.#sessions.set(key, opening)

    const session = await opening

    if (session === undefined && this.#sessions.get(key) === opening) this.#sessions.delete(key)

    return session
  }

  async #start(key: string, target: H2Target): Promise<ClientHttp2Session | undefined> {
    const socket = target.secure
      ? connectTls({
          host: target.dial,
          port: target.port,
          ALPNProtocols: ["h2", "http/1.1"],
          ...(isIP(target.hostname) === 0 && { servername: target.hostname }),
          rejectUnauthorized: !isLoopback(target.hostname),
        })
      : connectTcp({ host: target.dial, port: target.port })

    this.#own.track(socket)

    try {
      await once(socket, target.secure ? "secureConnect" : "connect")
    } catch {
      socket.destroy()

      return undefined
    }

    if (target.secure && Reflect.get(socket, "alpnProtocol") !== "h2") {
      socket.destroy()
      this.#http1.add(key)

      return undefined
    }

    const origin = `${target.secure ? "https" : "http"}://${hostInUrl(target.hostname)}:${target.port}`
    const session = connectH2(origin, { createConnection: () => socket })
    const opening = this.#sessions.get(key)

    const forget = () => {
      this.#open.delete(session)
      if (this.#sessions.get(key) === opening) this.#sessions.delete(key)
    }

    this.#open.add(session)
    session.on("error", forget)
    session.once("goaway", forget)
    session.once("close", forget)
    session.setTimeout(IDLE_MS, () => session.close())
    /* Like a kept-alive HTTP/1.1 connection, an idle session does not keep the process running. */
    session.unref()

    return session
  }

  closeAll(): void {
    for (const session of this.#open) session.destroy()
    this.#open.clear()
    this.#sessions.clear()
  }
}
