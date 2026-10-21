import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { request, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { serveBuilt } from "../src/built.ts"

const dist = mkdtempSync(join(tmpdir(), "danwo-dashboard-build-"))

/**
 * A stand-in for the built server: it echoes a POST's body, sets two cookies, opens an event
 * stream that sends one event and stays open, and answers anything else with its path.
 */
const HANDLER = `export default {
  async fetch(request) {
    const { pathname } = new URL(request.url)

    if (request.method === "POST") return new Response(await request.text())
    if (pathname === "/cookies") {
      const headers = new Headers()
      headers.append("set-cookie", "a=1")
      headers.append("set-cookie", "b=2")
      return new Response("ok", { headers })
    }
    if (pathname === "/events")
      return new Response(
        new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode("data: one\\n\\n")) }),
        { headers: { "content-type": "text/event-stream" } },
      )
    return new Response("page " + pathname, { headers: { "content-type": "text/html" } })
  },
}
`

let server: Server
let port: number

/** A raw request, so paths reach the server exactly as written. */
function get(path: string, method = "GET", body?: string) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
        let text = ""

        res.on("data", (chunk: Buffer) => {
          text += chunk.toString()

          if (res.headers["content-type"] === "text/event-stream") {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text })
            req.destroy()
          }
        })
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
        )
      })

      req.on("error", reject)
      req.end(body)
    },
  )
}

beforeAll(async () => {
  mkdirSync(join(dist, "client", "assets"), { recursive: true })
  mkdirSync(join(dist, "server"), { recursive: true })
  writeFileSync(join(dist, "client", "assets", "app-1a2b.js"), "console.log(1)")
  writeFileSync(join(dist, "client", "robots.txt"), "no")
  writeFileSync(join(dist, "secret.txt"), "not served")
  writeFileSync(join(dist, "server", "server.js"), HANDLER)
  server = await serveBuilt(dist, 0)
  const address = server.address()

  port = typeof address === "object" && address !== null ? address.port : 0
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
  rmSync(dist, { recursive: true, force: true })
})

describe("the built dashboard's server", () => {
  it("sends built files, keeping hashed assets for good", async () => {
    const asset = await get("/assets/app-1a2b.js")
    const robots = await get("/robots.txt")

    expect(asset).toMatchObject({ status: 200, body: "console.log(1)" })
    expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8")
    expect(asset.headers["cache-control"]).toContain("immutable")
    expect(robots.headers["cache-control"]).toBe("no-cache")
  })

  it("never sends a file outside the client build", async () => {
    expect((await get("/../secret.txt")).body).toBe("page /secret.txt")
    expect((await get("/%2e%2e/secret.txt")).body).not.toBe("not served")
  })

  it("hands pages and calls to the built handler, bodies and cookies included", async () => {
    expect(await get("/runs")).toMatchObject({ status: 200, body: "page /runs" })
    expect((await get("/assets/app-1a2b.js", "POST", "hello")).body).toBe("hello")
    expect((await get("/cookies")).headers["set-cookie"]).toEqual(["a=1", "b=2"])
  })

  it("streams an answer as it is written", async () => {
    expect((await get("/events")).body).toBe("data: one\n\n")
  })
})
