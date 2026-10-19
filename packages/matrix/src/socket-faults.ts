/**
 * WebSocket faults: every socket the clean run opened (a realtime channel, a collaboration
 * session) is tried again with its upgrade refused and with the connection dropped, which is what
 * a realtime provider's outage or a flaky network does to an app that expects its socket.
 */
import type { Proxy, SocketExchange, SocketFault } from "@danwo/proxy"

/** One socket fault, placed on one WebSocket the clean run opened. */
export interface SocketPlannedFault {
  readonly target: "socket"
  /** `WS host/path`, ids folded (`WS ws.pusher.test/app/:id`). */
  readonly route: string
  /** Which socket to `route` in the clean run, from 0. */
  readonly occurrence: number
  readonly fault: SocketFault
  readonly label: string
}

/** The socket faults tried on every WebSocket: refused at the upgrade, and dropped. */
const SOCKET_FAULTS: readonly SocketFault[] = [{ kind: "refuse" }, { kind: "reset" }]

const GENERATED = /^(?:\d+|[0-9a-f-]{16,}|(?=.*\d)[A-Za-z0-9_-]{16,})$/i

/** A socket's route: its host and path without query, generated ids folded to `:id`. */
export function socketRoute(socket: Pick<SocketExchange, "host" | "path">): string {
  const path = (socket.path.split("?")[0] ?? "")
    .split("/")
    .map((segment) => (GENERATED.test(segment) ? ":id" : segment))
    .join("/")

  return `WS ${socket.host}${path}`
}

/** Each socket the clean run opened (and the proxy let through) × each socket fault. */
export function planSocketFaults(sockets: readonly SocketExchange[]): SocketPlannedFault[] {
  const occurrences = new Map<string, number>()

  return sockets
    .filter((socket) => socket.disposition !== "blocked" && socket.status === 101)
    .flatMap((socket) => {
      const route = socketRoute(socket)
      const occurrence = occurrences.get(route) ?? 0
      const nth = occurrence > 0 ? ` #${occurrence + 1}` : ""

      occurrences.set(route, occurrence + 1)

      return SOCKET_FAULTS.map((fault) => ({
        target: "socket" as const,
        route,
        occurrence,
        fault,
        label: `${fault.kind === "refuse" ? "upgrade refused" : "connection dropped"} on ${route}${nth}`,
      }))
    })
}

/** Sets the proxy's socket fault rule so `planned` fires on its socket. */
export function applySocketFault(proxy: Proxy, planned: SocketPlannedFault): void {
  const seen = new Map<string, number>()

  proxy.setSocketFault((call) => {
    const route = socketRoute(call)
    const occurrence = seen.get(route) ?? 0

    seen.set(route, occurrence + 1)

    return route === planned.route && occurrence === planned.occurrence ? planned.fault : undefined
  })
}
