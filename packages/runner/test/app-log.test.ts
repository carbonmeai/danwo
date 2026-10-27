/**
 * The app log of a session: a navigation the browser could not load names the browser's reason,
 * where the page alone would only show `chrome-error://chromewebdata/`.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession } from "../src/session.ts"
import { freePort } from "../src/support/ports.ts"

let server: Server
let url: string
/** A port nothing listens on, so a link to it cannot load. */
let closed: number

beforeAll(async () => {
  closed = await freePort()
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html><title>Start</title><a href="http://127.0.0.1:${closed}/pay">Pay</a>`)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()

  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`
})

afterAll(async () => {
  server.close()
  await once(server, "close")
})

describe("the app log", () => {
  it("names why a navigation could not be loaded", async () => {
    const session = await openWebSession({ baseUrl: url })

    try {
      await session.app.open("/")
      await session.screen.getByRole("link", { name: "Pay" }).click()
      await expect
        .poll(() => session.flight.appLog().map((line) => [line.level, line.text]))
        .toContainEqual([
          "error",
          `http://127.0.0.1:${closed}/pay could not be loaded: net::ERR_CONNECTION_REFUSED`,
        ])
    } finally {
      await session.close()
    }
  }, 60_000)
})
