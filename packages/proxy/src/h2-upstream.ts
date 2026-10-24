/**
 * HTTP/2 sessions to the hosts the proxy passes HTTP/2 streams on to, one per origin, shared by
 * every stream to it. Over TLS the host picks the protocol through ALPN: one that answers HTTP/1.1
 * is remembered as such, and its streams pass on over HTTP/1.1 instead. Without TLS, a client that
 * spoke HTTP/2 from its first byte knew its server does, so the proxy does the same.
 */
import { once } from "node:events"
import { type ClientHttp2Session, connect as connectH2 } from "node:http2"
import { connect as connectTcp, isIP } from "node:net"
import type { Readable, Writable } from "node:stream"
import { connect as connectTls } from "node:tls"

import { isLoopback } from "./hosts.ts"
import type { OwnConnections } from "./loop.ts"

/** How long a session with no streams stays open before the proxy closes it. */
const IDLE_MS = 60_000

/** The most of an unanswered request body kept to send again; past it, the stream is not retried. */
const MAX_REPLAY_BYTES = 1024 * 1024

/** A session to stream on, and whether it carried streams before this one. */
export interface PooledSession {
  readonly session: ClientHttp2Session
  readonly reused: boolean
}

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
  async sessionFor(target: H2Target): Promise<PooledSession | undefined> {
    const key = `${target.secure ? "https" : "http"}://${target.hostname}:${target.port}@${target.dial}`
    const known = await this.#live(key)

    if (known !== undefined) return { session: known, reused: true }
    if (this.#http1.has(key)) return undefined

    const opening = this.#start(key, target)

    this.#sessions.set(key, opening)

    const session = await opening

    if (session === undefined && this.#sessions.get(key) === opening) this.#sessions.delete(key)

    return session && { session, reused: false }
  }

  /** The pooled session for `key`, once it has opened, if it is still open. */
  async #live(key: string): Promise<ClientHttp2Session | undefined> {
    const session = await this.#sessions.get(key)

    return session?.closed === false && !session.destroyed ? session : undefined
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

/**
 * A request body passed on to a server's stream as it arrives, and kept, up to a bound, while the
 * stream is unanswered: a stream the server refused, or one opened on a session that was closing,
 * can then be sent again whole on a fresh one. Once the server answers, nothing more is kept.
 */
export class ReplayBody {
  readonly #source: Readable
  #kept: Buffer[] | undefined = []
  #size = 0
  #ended = false
  #sink: Writable | undefined

  constructor(source: Readable) {
    this.#source = source
    source.on("data", (chunk: Buffer) => {
      this.#keep(chunk)

      if (this.#sink?.write(chunk) === false) {
        source.pause()
        this.#sink.once("drain", () => source.resume())
      }
    })
    source.once("end", () => {
      this.#ended = true
      this.#sink?.end()
    })
  }

  /** Whether all of the body so far is kept, so it can be sent again. */
  get replayable(): boolean {
    return this.#kept !== undefined
  }

  /** Sends what has arrived to `sink`, then the rest as it comes; ends it once the body has. */
  attach(sink: Writable): void {
    this.#sink = sink
    for (const chunk of this.#kept ?? []) sink.write(chunk)
    if (this.#ended) sink.end()
    else this.#source.resume()
  }

  /** The server answered: the body need not be kept any more. */
  release(): void {
    this.#kept = undefined
  }

  #keep(chunk: Buffer): void {
    if (this.#kept === undefined) return
    this.#size += chunk.length
    if (this.#size > MAX_REPLAY_BYTES) this.#kept = undefined
    else this.#kept.push(chunk)
  }
}
