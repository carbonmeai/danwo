/**
 * Calls the proxy would forward to itself. A request whose destination is the proxy (sent straight
 * to its address, or to a name that resolves back to it) would be passed on to the proxy, which
 * would pass it on again, forever. The proxy knows every connection it opened to pass something
 * on, by both ends; a connection that arrives with those same two ends, swapped, is one of its
 * own coming back.
 *
 * Both ends matter. On Linux, connections to different servers can share a source port, so an
 * app's call to the proxy can come from the very port the proxy uses for its own connection to
 * another app on this machine; matching the source alone would refuse that call as a loop.
 */
import type { Socket } from "node:net"

/** The two ends of a TCP connection, as a socket reports them. */
export interface SocketEnds {
  readonly localAddress?: string | undefined
  readonly localPort?: number | undefined
  readonly remoteAddress?: string | undefined
  readonly remotePort?: number | undefined
}

/** `address` without the prefix an IPv4 address carries on a dual-stack socket. */
function plain(address: string | undefined): string | undefined {
  return address?.startsWith("::ffff:") ? address.slice("::ffff:".length) : address
}

/**
 * Whether `incoming` is the far end of `outgoing`: it comes from where `outgoing` starts, and
 * arrived where `outgoing` goes. When `incoming` does not know where it arrived, its source alone
 * has to do.
 */
function isOwnConnection(outgoing: SocketEnds, incoming: SocketEnds): boolean {
  if (!outgoing.localAddress || !outgoing.localPort) return false

  const fromThere =
    plain(outgoing.localAddress) === plain(incoming.remoteAddress) &&
    outgoing.localPort === incoming.remotePort

  if (!fromThere) return false
  if (!incoming.localPort || !outgoing.remotePort) return true

  return (
    plain(outgoing.remoteAddress) === plain(incoming.localAddress) &&
    outgoing.remotePort === incoming.localPort
  )
}

/** The connections a proxy opened to pass calls on, while they are open. */
export class OwnConnections {
  /** Each open connection, with its ends as they were once it connected. */
  readonly #open = new Map<Socket, SocketEnds>()
  /** Every connection tracked and not yet closed, connected or still connecting. */
  readonly #sockets = new Set<Socket>()

  /** Starts tracking `socket` once it has connected, until it closes. Tracking it twice is a no-op. */
  track(socket: Socket): void {
    if (this.#sockets.has(socket) || socket.destroyed) return
    this.#sockets.add(socket)

    const remember = () => {
      if (socket.destroyed) return
      this.#open.set(socket, {
        localAddress: socket.localAddress,
        localPort: socket.localPort,
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
      })
    }

    if (socket.connecting) socket.once("connect", remember)
    else remember()
    socket.once("close", () => {
      this.#open.delete(socket)
      this.#sockets.delete(socket)
    })
  }

  /** Whether `incoming`, a connection to the proxy, is one of these coming back. */
  isLoop(incoming: SocketEnds): boolean {
    for (const ends of this.#open.values()) if (isOwnConnection(ends, incoming)) return true

    return false
  }

  /** Closes every connection still open. */
  destroyAll(): void {
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
    this.#open.clear()
  }
}
