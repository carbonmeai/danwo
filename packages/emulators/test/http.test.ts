import { once } from "node:events"

import { describe, expect, it } from "vitest"

import { HttpError, providerErrors } from "../src/errors.ts"
import { App, serve } from "../src/http.ts"
import { isRecord } from "../src/json.ts"
import { listeningPort } from "../src/net.ts"

const request = (path: string, init?: RequestInit) =>
  new Request(`http://emulator.test${path}`, init)

describe("App routing", () => {
  it("matches method and path, with decoded parameters", async () => {
    const app = new App()

    app.get("/v1/things/:id", (c) => c.json({ id: c.req.param("id") }))
    app.post("/v1/things/:id/archive", (c) => c.json({ archived: c.req.param("id") }, 201))

    const read = await app.fetch(request("/v1/things/a%20b"))
    const archive = await app.fetch(request("/v1/things/x/archive", { method: "POST" }))

    expect(await read.json()).toEqual({ id: "a b" })
    expect(archive.status).toBe(201)
    expect(await archive.json()).toEqual({ archived: "x" })
  })

  it("answers 404 for an unknown path or a method without a route", async () => {
    const app = new App()

    app.get("/only-get", (c) => c.text("ok"))

    expect((await app.fetch(request("/missing"))).status).toBe(404)
    expect((await app.fetch(request("/only-get", { method: "DELETE" }))).status).toBe(404)
  })

  it("ignores a trailing slash and reads the first query value", async () => {
    const app = new App()

    app.get("/search", (c) => c.text(c.req.query("q") ?? "none"))

    expect(await (await app.fetch(request("/search/?q=one&q=two"))).text()).toBe("one")
    expect(await (await app.fetch(request("/search"))).text()).toBe("none")
  })
})

describe("middleware", () => {
  it("runs in order before the route and can rewrite the downstream response", async () => {
    const app = new App()
    const seen: string[] = []

    app.use(async (c, next) => {
      seen.push("outer")
      const response = await next()

      return c.json({ wrapped: await response.json() }, response.status)
    })
    app.use(() => {
      seen.push("inner")
    })
    app.get("/value", (c) => c.json(1))

    const response = await app.fetch(request("/value"))

    expect(seen).toEqual(["outer", "inner"])
    expect(await response.json()).toEqual({ wrapped: 1 })
  })

  it("can answer without calling next", async () => {
    const app = new App()
    let reached = false

    app.use((c) => c.text("blocked", 401))
    app.get("/secret", (c) => {
      reached = true

      return c.text("secret")
    })

    expect((await app.fetch(request("/secret"))).status).toBe(401)
    expect(reached).toBe(false)
  })

  it("adds headers set on the context to the final response", async () => {
    const app = new App()

    app.use(async (c, next) => {
      c.header("x-trace", "abc")

      return next()
    })
    app.get("/", (c) => c.json({}, 200, { "x-own": "yes" }))

    const response = await app.fetch(request("/"))

    expect(response.headers.get("x-trace")).toBe("abc")
    expect(response.headers.get("x-own")).toBe("yes")
    expect(response.headers.get("content-type")).toBe("application/json")
  })
})

describe("request bodies", () => {
  it("can be read more than once, as text, JSON and bytes", async () => {
    const app = new App()

    app.post("/echo", async (c) => {
      const text = await c.req.text()
      const json = await c.req.json()
      const bytes = await c.req.arrayBuffer()

      return c.json({ text, n: isRecord(json) ? json.n : undefined, size: bytes.byteLength })
    })

    const response = await app.fetch(request("/echo", { method: "POST", body: '{"n":7}' }))

    expect(await response.json()).toEqual({ text: '{"n":7}', n: 7, size: 7 })
  })

  it("parses URL-encoded and multipart forms", async () => {
    const app = new App()

    app.post("/form", async (c) => {
      const fields = await c.req.parseBody()
      const file = fields.upload

      return c.json({
        name: fields.name,
        file: file instanceof File ? await file.text() : null,
      })
    })

    const encoded = await app.fetch(
      request("/form", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "name=Ada&name=Grace",
      }),
    )
    const form = new FormData()

    form.set("name", "Lin")
    form.set("upload", new File(["bytes"], "a.txt"))

    const multipart = await app.fetch(request("/form", { method: "POST", body: form }))

    expect(await encoded.json()).toEqual({ name: "Grace", file: null })
    expect(await multipart.json()).toEqual({ name: "Lin", file: "bytes" })
  })
})

describe("errors", () => {
  it("turns thrown errors into the provider's format, keeping an HttpError's status", async () => {
    const app = new App()

    app.onError(providerErrors((c, status, message) => c.json({ problem: message }, status)))
    app.get("/teapot", () => {
      throw new HttpError(418, "short and stout")
    })
    app.get("/broken", () => {
      throw new Error("boom")
    })

    const teapot = await app.fetch(request("/teapot"))
    const broken = await app.fetch(request("/broken"))

    expect(teapot.status).toBe(418)
    expect(await teapot.json()).toEqual({ problem: "short and stout" })
    expect(broken.status).toBe(500)
    expect(await broken.json()).toEqual({ problem: "boom" })
  })
})

describe("serve", () => {
  it("puts an app on a real port", async () => {
    const app = new App()

    app.post("/upper", async (c) => c.text((await c.req.text()).toUpperCase()))

    const server = serve({ fetch: (r) => app.fetch(r), port: 0 })

    await once(server, "listening")

    try {
      const port = listeningPort(server)
      const response = await fetch(`http://127.0.0.1:${port}/upper`, {
        method: "POST",
        body: "quiet",
      })

      expect(await response.text()).toBe("QUIET")
    } finally {
      server.close()
    }
  })
})
