/**
 * WebSocket faults: every socket the clean run opened (a realtime channel, a collaboration
 * session) is tried again with its upgrade refused and with the connection dropped, which is what
 * a realtime provider's outage or a flaky network does to an app that expects its socket.
 */
import type { Proxy, SocketExchange, SocketFault } from "@danwo/proxy"

import { occurrenceOf } from "./occurrence.ts"

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

/**
 * A socket's route: its host and path without query, generated ids folded to `:id`, and the person
 * whose browser opened it (`for bob`) when the test opened more than one person's browser, so a
 * fault can land on one person's socket and not another's.
 */
export function socketRoute(socket: Pick<SocketExchange, "host" | "path" | "user">): string {
  const path = (socket.path.split("?")[0] ?? "")
    .split("/")
    .map((segment) => (GENERATED.test(segment) ? ":id" : segment))
    .join("/")
  const user = socket.user === undefined ? "" : ` for ${socket.user}`

  return `WS ${socket.host}${path}${user}`
}

/**
 * Each socket the clean run opened (and the proxy let through) × each socket fault. A socket in
 * `setupCaused` is counted but gets no faults.
 */
export function planSocketFaults(
  sockets: readonly SocketExchange[],
  setupCaused: ReadonlySet<SocketExchange> = new Set(),
): SocketPlannedFault[] {
  const occurrences = new Map<string, number>()

  return sockets
    .filter((socket) => socket.disposition !== "blocked" && socket.status === 101)
    .flatMap((socket) => {
      const route = socketRoute(socket)
      const occurrence = occurrences.get(route) ?? 0
      const nth = occurrence > 0 ? ` #${occurrence + 1}` : ""

      occurrences.set(route, occurrence + 1)
      if (setupCaused.has(socket)) return []

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
  const hits = occurrenceOf(socketRoute, planned)

  proxy.setSocketFault((call) => (hits(call) ? planned.fault : undefined))
}
