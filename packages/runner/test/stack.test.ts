import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { liveKeyWarnings } from "../src/runner/app-checks.ts"
import { inngestOutboundFaults, inngestService, INNGEST_HOST } from "../src/runner/inngest.ts"
import { startServices } from "../src/runner/services.ts"
import { startOrder } from "../src/runner/stack-environment.ts"

const app = (name: string, dependsOn?: readonly string[]) => ({
  name,
  command: "true",
  url: "http://127.0.0.1:1",
  ...(dependsOn && { dependsOn }),
})

describe("the stack's start order", () => {
  it("starts apps in dependsOn order, those with nothing between them together", () => {
    const order = startOrder([
      app("web", ["api"]),
      app("api", ["inngest"]),
      app("worker", ["inngest"]),
      app("inngest"),
    ])

    expect(order.map((batch) => batch.map((a) => a.name))).toEqual([
      ["inngest"],
      ["api", "worker"],
      ["web"],
    ])
  })

  it("names a missing dependency and a cycle", () => {
    expect(() => startOrder([app("web", ["api"])])).toThrow(/web depends on api/)
    expect(() => startOrder([app("a", ["b"]), app("b", ["a"])])).toThrow(/cycle among a, b/)
  })
})

describe("live provider keys", () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it("flags live keys for providers the run does not emulate, by name, never by value", async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-keys-"))
    await writeFile(
      join(dir, ".env"),
      [
        "STRIPE_SECRET_KEY=REDACTED-TEST-VALUE",
        "RESEND_API_KEY=REDACTED-TEST-VALUE",
        "export OPENAI_API_KEY='REDACTED-TEST-VALUE'",
        "CLERK_SECRET_KEY=sk_test_fine",
      ].join("\n"),
    )

    const warnings = await liveKeyWarnings({
      app: "api",
      cwd: dir,
      env: {},
      overridden: new Set(["OPENAI_API_KEY"]),
      services: new Set(["resend"]),
      passthrough: true,
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^api: STRIPE_SECRET_KEY \(\.env\) looks like a live stripe key/)
    expect(warnings.join("\n")).not.toContain("abcdefgh")
  })

  it("stays quiet when unrouted hosts are blocked", async () => {
    const warnings = await liveKeyWarnings({
      app: "api",
      cwd: undefined,
      env: { STRIPE_SECRET_KEY: "REDACTED-TEST-VALUE" },
      overridden: new Set(),
      services: new Set(),
      passthrough: false,
    })

    expect(warnings).toEqual([])
  })
})

/**
 * A stand-in for the Inngest dev server's event and runs API: an event it accepts triggers one
 * run, which finishes `runMs` later.
 */
async function devServer(runMs: number): Promise<{ server: Server; url: string }> {
  const accepted = new Map<string, number>()
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.startsWith("/e/")) {
      const id = `evt_${accepted.size + 1}`

      accepted.set(id, Date.now())
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ids: [id] }))

      return
    }

    const id = /^\/v1\/events\/([^/]+)\/runs$/.exec(req.url ?? "")?.[1] ?? ""
    const at = accepted.get(id)
    const done = at !== undefined && Date.now() - at >= runMs
    const runs =
      at === undefined
        ? []
        : [
            {
              run_id: `run_${id}`,
              function_id: "provision-workspace",
              status: done ? "Completed" : "Running",
              run_started_at: new Date(at).toISOString(),
              ...(done && { ended_at: new Date(at + runMs).toISOString() }),
            },
          ]

    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: runs }))
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, url: `http://127.0.0.1:${port}` }
}

describe("Inngest", () => {
  it("routes events through the proxy and settles once the runs they triggered finish", async () => {
    const dev = await devServer(400)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      expect(inngest.env).toEqual({ INNGEST_DEV: "1", INNGEST_BASE_URL: `http://${INNGEST_HOST}` })

      await sendThrough(services.proxy.url)

      const began = Date.now()

      await services.settle()
      expect(Date.now() - began).toBeGreaterThanOrEqual(250)
      expect(services.state()).toMatchObject({
        inngest: {
          runs: [
            {
              event: "evt_1",
              functionId: "provision-workspace",
              status: "completed",
              durationMs: 400,
            },
          ],
        },
      })
    } finally {
      await services.close()
      dev.server.close()
    }
  })

  it("faults event sends: down, accepted but unanswered, and slow", () => {
    const kinds = inngestOutboundFaults({
      host: INNGEST_HOST,
      method: "POST",
      path: "/e/key",
      index: 0,
    })

    expect(kinds.map((fault) => fault.kind)).toEqual(["status", "reset-after", "delay"])
    expect(
      inngestOutboundFaults({ host: INNGEST_HOST, method: "GET", path: "/v1/x", index: 0 }),
    ).toEqual([])
  })
})

/**
 * Sends one event to the Inngest host through the proxy, the way an app's SDK would: the test
 * process itself is not routed, so it speaks to the proxy directly.
 */
async function sendThrough(proxyUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const target = new URL(proxyUrl)
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        method: "POST",
        path: `http://${INNGEST_HOST}/e/test-key`,
        headers: { host: INNGEST_HOST, "content-type": "application/json" },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve())
      },
    )

    req.on("error", reject)
    req.end(JSON.stringify({ name: "workspace.created" }))
  })
}
