/**
 * Before passing a call to `localhost` on, the interception library asks whether the port listens
 * on IPv6 by binding one shared server, and every ask leaves a listener on that server: past ten
 * calls to free ports Node warns of a leak, and it keeps growing. Its handlers look the check up
 * on its module each time, so it is swapped here for {@link isListening}, which opens a connection
 * per ask and leaves nothing behind.
 */
import { createRequire } from "node:module"

import { isListening } from "./listening.ts"

/** The part of the library's socket helpers this replaces. */
interface SocketHelpers {
  readonly isLocalIPv6Available: boolean
  isLocalPortActive(host: string, port: number): Promise<boolean>
}

function isSocketHelpers(value: unknown): value is SocketHelpers {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "isLocalPortActive") === "function"
  )
}

let replaced = false

/** Replaces the library's local port check, once per process. */
export function replaceLocalPortProbe(): void {
  if (replaced) return

  const helpers: unknown = createRequire(import.meta.url)("mockttp/dist/util/socket-util")

  if (!isSocketHelpers(helpers)) throw new Error("mockttp no longer has isLocalPortActive")

  helpers.isLocalPortActive = (host, port) =>
    host === "::1" && !helpers.isLocalIPv6Available
      ? Promise.resolve(false)
      : isListening(host, port)
  replaced = true
}
