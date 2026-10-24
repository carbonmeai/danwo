/**
 * Two of the interception library's socket helpers misjudge calls to this machine, and its
 * handlers look both up on its module each time, so they are swapped here, once per process.
 *
 * Before passing a call to `localhost` on, it asks whether the port listens on IPv6 by binding one
 * shared server, and every ask leaves a listener on that server: past ten calls to free ports Node
 * warns of a leak, and it keeps growing. {@link isListening} opens a connection per ask instead.
 *
 * Before passing any call on, it checks the call is not one of its own coming back (a request
 * sent straight to the proxy, which would forward it to itself forever) by comparing the client's
 * address and port with the source address and port of each connection it has open upstream. On
 * Linux that is not enough: connections to different servers share source ports, so an app's call
 * to the proxy can come from the very port the proxy uses for its own connection to another app on
 * this machine, and the call is refused as a loop. {@link isOwnConnection} compares both ends.
 */
import { createRequire } from "node:module"

import { isListening } from "./listening.ts"

/** The two ends of a connection, as a socket reports them; any may be unknown on a closed one. */
interface SocketEnds {
  readonly localAddress?: string | undefined
  readonly localPort?: number | undefined
  readonly remoteAddress?: string | undefined
  readonly remotePort?: number | undefined
}

/** The part of the library's socket helpers this replaces. */
interface SocketHelpers {
  readonly isLocalIPv6Available: boolean
  isLocalPortActive(host: string, port: number): Promise<boolean>
  isSocketLoop(outgoing: Iterable<SocketEnds>, incoming: SocketEnds): boolean
}

function isSocketHelpers(value: unknown): value is SocketHelpers {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "isLocalPortActive") === "function" &&
    typeof Reflect.get(value, "isSocketLoop") === "function"
  )
}

/** `address` without the prefix an IPv4 address carries on a dual-stack socket. */
function plain(address: string | undefined): string | undefined {
  return address?.startsWith("::ffff:") ? address.slice("::ffff:".length) : address
}

/**
 * Whether `incoming` is the far end of `outgoing`: the client is this connection's source, and the
 * server it reached is this one. When `incoming` does not know its own end, which a tunnelled
 * socket may not, matching the source alone has to do, as the library does.
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

let replaced = false

/** The library's socket helpers, or undefined when a later version moved or renamed them. */
function socketHelpers(): SocketHelpers | undefined {
  try {
    const helpers: unknown = createRequire(import.meta.url)("mockttp/dist/util/socket-util")

    return isSocketHelpers(helpers) ? helpers : undefined
  } catch {
    return undefined
  }
}

/**
 * Replaces the library's local port check and loop check, once per process. When a later version
 * has moved them, the proxy runs with the library's own and says so once: that version may well
 * have fixed them, and a warning is better than a proxy that will not start.
 */
export function replaceSocketHelpers(): void {
  if (replaced) return

  replaced = true

  const helpers = socketHelpers()

  if (helpers === undefined) {
    process.emitWarning(
      "danwo: this mockttp version has no isLocalPortActive or isSocketLoop to replace; using its own socket checks",
    )

    return
  }

  helpers.isLocalPortActive = (host, port) =>
    host === "::1" && !helpers.isLocalIPv6Available
      ? Promise.resolve(false)
      : isListening(host, port)
  helpers.isSocketLoop = (outgoing, incoming) =>
    [...outgoing].some((socket) => isOwnConnection(socket, incoming))
}
