import type { Server } from "node:net"

/**
 * The TCP port a listening server is bound to. Throws when the server is not listening yet, or is
 * bound to a pipe or socket path rather than a port.
 */
export function listeningPort(server: Server): number {
  const address = server.address()

  if (address === null || typeof address === "string")
    throw new Error("the server is not listening on a TCP port")

  return address.port
}
