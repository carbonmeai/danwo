import { once } from "node:events"
import { createServer, request, type Server } from "node:http"
import { connect, type Socket } from "node:net"

import { listeningPort } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OwnConnections } from "../src/loop.ts"
import { type Proxy, startProxy } from "../src/proxy.ts"

let app: Server
let proxy: Proxy
/** The app's end of each connection it accepted, newest last. */
const accepted: Socket[] = []

/** Opens a connection to the app, as the proxy does when it passes a call through. */
async function upstream(): Promise<Socket> {
  const socket = connect(listeningPort(app), "127.0.0.1")

  await once(socket, "connect")
  /* The app's end is accepted on its own turn. */
  while (accepted.length === 0 || accepted.at(-1)?.remotePort !== socket.localPort)
    await new Promise((resolve) => setImmediate(resolve))

  return socket
}

/** GETs `url` through the proxy, as an app with HTTP_PROXY set does; its status, or the error. */
function viaProxy(url: string): Promise<number | string> {
  const at = new URL(proxy.url)

  return new Promise((resolve) => {
    request(
      { host: at.hostname, port: at.port, path: url, headers: { host: new URL(url).host } },
      (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode ?? 0))
      },
    )
      .on("error", (error) => resolve(error.message))
      .end()
  })
}

beforeAll(async () => {
  app = createServer((_req, res) => res.writeHead(200).end("ok"))
  app.on("connection", (socket) => accepted.push(socket))
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  proxy = await startProxy({ routes: [] })
})

afterAll(async () => {
  await proxy.stop()
  app.closeAllConnections()
  app.close()
})

describe("the loop check on calls passed through", () => {
  it("lets through a call from the source port of the proxy's own connection to another app", async () => {
    const toApp = await upstream()
    const at = new URL(proxy.url)

    try {
      /*
       * Linux lets connections to different servers share a source port, so an app's call to the
       * proxy can come from the port the proxy's connection to another app uses.
       */
      const callToProxy = {
        remoteAddress: "127.0.0.1",
        remotePort: toApp.localPort,
        localAddress: "127.0.0.1",
        localPort: Number(at.port),
      }

      const own = new OwnConnections()

      own.track(toApp)
      expect(own.isLoop(callToProxy)).toBe(false)
    } finally {
      toApp.destroy()
    }
  })

  it("still catches a connection of the proxy's own coming back to it", async () => {
    const toApp = await upstream()

    try {
      const own = new OwnConnections()

      own.track(toApp)
      expect(own.isLoop(accepted.at(-1) ?? {})).toBe(true)
    } finally {
      toApp.destroy()
    }
  })

  it("still refuses a call sent to the proxy's own address, rather than forwarding it forever", async () => {
    expect(await viaProxy(`${proxy.url}/loop`)).not.toBe(200)
    expect(await viaProxy(`http://127.0.0.1:${listeningPort(app)}/ok`)).toBe(200)
  })
})
