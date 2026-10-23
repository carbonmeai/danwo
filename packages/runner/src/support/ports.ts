import { createServer } from "node:net"

/**
 * A TCP port nothing listens on now, on 127.0.0.1: for an app a config starts on a port of its
 * own, as in `url: \`http://127.0.0.1:${await freePort()}\``, so runs and workers never collide.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("the port probe did not listen on a TCP port")),
      )
    })
  })
}
