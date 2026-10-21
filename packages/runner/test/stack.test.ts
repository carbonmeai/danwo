import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request, type Server, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { liveKeyWarnings } from "../src/runner/app-checks.ts"
import { inngestOutboundFaults, inngestService, INNGEST_HOST } from "../src/runner/inngest.ts"
import { startServices } from "../src/runner/services.ts"
import { startOrder } from "../src/runner/stack-environment.ts"
import { fakeKey } from "./fake-key.ts"

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
        `STRIPE_SECRET_KEY=${fakeKey("sk_", "live_abcdefghijklmnopqrstuvwx")}`,
        `RESEND_API_KEY=${fakeKey("re_", "live1234567890abcdef")}`,
        `export OPENAI_API_KEY='${fakeKey("sk-", "proj-abcdefghijklmnopqrstuvwxyz0123456789")}'`,
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

  it("knows Gemini, Perplexity and Bedrock keys, emulated by the model API service", async () => {
    const env = {
      GEMINI_API_KEY: fakeKey("AIza", "SyDanwoEmulatedKey00000000000000000"),
      PERPLEXITY_API_KEY: "pplx-danwoEmulatedKey000000000000",
      AWS_BEARER_TOKEN_BEDROCK: fakeKey("ABSK", "ZGFud28tZW11bGF0ZWQta2V5LTAwMDAwMDAw"),
    }
    const check = {
      app: "api",
      cwd: undefined,
      env,
      overridden: new Set<string>(),
      passthrough: true,
    }
    const unemulated = await liveKeyWarnings({ ...check, services: new Set() })
    const emulated = await liveKeyWarnings({ ...check, services: new Set(["llm"]) })

    expect(unemulated.map((warning) => /live (\w+) key/.exec(warning)?.[1])).toEqual([
      "gemini",
      "perplexity",
      "bedrock",
    ])
    expect(emulated).toEqual([])
  })

  it("stays quiet when unrouted hosts are blocked", async () => {
    const warnings = await liveKeyWarnings({
      app: "api",
      cwd: undefined,
      env: { STRIPE_SECRET_KEY: fakeKey("sk_", "live_abcdefghijklmnopqrstuvwx") },
      overridden: new Set(),
      services: new Set(),
      passthrough: false,
    })

    expect(warnings).toEqual([])
  })
})

/**
 * The run an event accepted at `at` triggered, finished once `runMs` has passed. A checkpointed
 * one is listed as completed with no end time from the start, as the dev server lists a run whose
 * SDK checkpoints its steps.
 */
function runOf(id: string, at: number, runMs: number, checkpointed = false) {
  if (checkpointed)
    return {
      run_id: `run_${id}`,
      function_id: "provision-workspace",
      status: "Completed",
      run_started_at: new Date(at).toISOString(),
      ended_at: null,
    }

  const done = Date.now() - at >= runMs

  return {
    run_id: `run_${id}`,
    function_id: "provision-workspace",
    status: done ? "Completed" : "Running",
    run_started_at: new Date(at).toISOString(),
    ...(done && { ended_at: new Date(at + runMs).toISOString() }),
  }
}

/** The dev server's GraphQL answer listing its functions: one per event, with a cron beside it. */
function functionsAnswer(events: readonly string[]) {
  const functions = events.map((value) => ({
    triggers: [
      { type: "EVENT", value },
      { type: "CRON", value: "* * * * *" },
    ],
  }))

  return { data: { functions } }
}

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value))
}

/**
 * A stand-in for the Inngest dev server's event and runs API: an event it accepts triggers one
 * run, which finishes `runMs` later and shows up only `lagMs` after the event, as a busy dev
 * server schedules it. Its GraphQL lists functions listening to `triggers`; with none listed,
 * settling cannot tell which events start no run.
 */
async function devServer(
  runMs: number,
  lagMs = 0,
  checkpointed = false,
  triggers: readonly string[] = [],
): Promise<{ server: Server; url: string }> {
  const accepted = new Map<string, number>()
  const server = createServer((req, res) => {
    if (req.url === "/v0/gql") {
      json(res, functionsAnswer(triggers))

      return
    }

    if (req.method === "POST" && req.url?.startsWith("/e/")) {
      const id = `evt_${accepted.size + 1}`

      accepted.set(id, Date.now())
      json(res, { ids: [id] })

      return
    }

    const id = /^\/v1\/events\/([^/]+)\/runs$/.exec(req.url ?? "")?.[1] ?? ""
    const at = accepted.get(id)

    json(res, {
      data: at === undefined || Date.now() - at < lagMs ? [] : [runOf(id, at, runMs, checkpointed)],
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, url: `http://127.0.0.1:${port}` }
}

describe("Inngest", () => {
  it("puts the events a travelled app sends back on real time, so their runs start now", async () => {
    const received: unknown[] = []
    const dev = createServer((req, res) => {
      let text = ""

      req.on("data", (chunk: Buffer) => (text += chunk.toString()))
      req.on("end", () => {
        received.push(JSON.parse(text))
        json(res, { ids: ["evt_1"] })
      })
    })

    dev.listen(0, "127.0.0.1")
    await once(dev, "listening")

    const address = dev.address()
    const port = typeof address === "object" && address !== null ? address.port : 0
    const services = await startServices([
      await inngestService({ url: `http://127.0.0.1:${port}` }),
    ])
    const DAY = 86_400_000

    try {
      await services.travel(11 * DAY)

      const sentAt = Date.now() + 11 * DAY

      await sendThrough(services.proxy.url, "/e/key", [
        { name: "billing/trial.ending", ts: sentAt },
        { name: "no.ts" },
      ])

      const [batch] = received
      const ts = Number(Reflect.get(Object(Reflect.get(Object(batch), 0)), "ts"))

      expect(Math.abs(ts - (sentAt - 11 * DAY))).toBeLessThan(5_000)
      expect(Reflect.get(Object(batch), 1)).toEqual({ name: "no.ts" })
    } finally {
      await services.close()
      dev.close()
    }
  })

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

  it("waits for events the runs send while it settles, and for runs a busy server shows late", async () => {
    const dev = await devServer(300, 2_000)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await sendThrough(services.proxy.url)
      /* A function the first event started sends a second one once settling has begun. */
      const followUp = new Promise<void>((resolve) => {
        setTimeout(() => void sendThrough(services.proxy.url).then(resolve), 500)
      })

      await services.settle()
      await followUp
      expect(services.state()).toMatchObject({
        inngest: {
          runs: [
            { event: "evt_1", status: "completed" },
            { event: "evt_2", status: "completed" },
          ],
        },
      })
    } finally {
      await services.close()
      dev.server.close()
    }
  }, 20_000)

  it("waits for a run the SDK checkpoints until its checkpoints stop", async () => {
    const dev = await devServer(0, 0, true)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await sendThrough(services.proxy.url)

      /* The function's steps checkpoint for a second while the dev server lists it as completed. */
      let lastCheckpoint = 0
      const steps = (async () => {
        for (let step = 0; step < 4; step++) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          await sendThrough(services.proxy.url, "/v1/checkpoint/run_evt_1/async")
          lastCheckpoint = Date.now()
        }
      })()

      await services.settle()
      expect(lastCheckpoint).toBeGreaterThan(0)
      expect(Date.now() - lastCheckpoint).toBeGreaterThanOrEqual(1_000)
      await steps
    } finally {
      await services.close()
      dev.server.close()
    }
  }, 20_000)

  it("says what it waited for: each run with its function, status and time", async () => {
    const dev = await devServer(400)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await sendThrough(services.proxy.url)

      const [line = ""] = await services.settle()

      expect(line).toMatch(/^inngest · \d+\.\d s · provision-workspace completed in 0\.4 s$/)
    } finally {
      await services.close()
      dev.server.close()
    }
  })

  it("does not wait on an app that keeps registering its functions", async () => {
    const dev = await devServer(400)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])
    /* The SDK registers with the dev server again and again while the app runs. */
    const registering = setInterval(
      () => void sendThrough(services.proxy.url, "/fn/register").catch(() => undefined),
      50,
    )

    try {
      await new Promise((resolve) => setTimeout(resolve, 200))

      const began = Date.now()
      const waited = await services.settle()

      expect(Date.now() - began).toBeLessThan(500)
      expect(waited).toEqual([])
    } finally {
      clearInterval(registering)
      await services.close()
      dev.server.close()
    }
  })

  it("gives an event that starts no run its few seconds once, from when it was sent", async () => {
    /* A run that never shows: the event has no function listening to it. */
    const dev = await devServer(0, 60_000)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await sendThrough(services.proxy.url)

      const [first = ""] = await services.settle()
      const began = Date.now()

      await services.settle()
      expect(first).toMatch(/event evt_1 started no run$/)
      expect(Date.now() - began).toBeLessThan(500)
    } finally {
      await services.close()
      dev.server.close()
    }
  }, 20_000)

  it("does not wait for a run from an event no registered function listens to", async () => {
    /* The functions listen to other events, one through a wildcard that does not match. */
    const dev = await devServer(0, 60_000, false, ["billing/invoice.paid", "workspace.*.deleted"])
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await sendThrough(services.proxy.url)

      const began = Date.now()
      const [line = ""] = await services.settle()

      expect(Date.now() - began).toBeLessThan(1_000)
      expect(line).toMatch(/event evt_1 started no run$/)
    } finally {
      await services.close()
      dev.server.close()
    }
  })

  it("still gives a listened-to event time to show its run", async () => {
    /* A wildcard trigger listens to the event, and the busy dev server shows the run late. */
    const dev = await devServer(200, 1_500, false, ["workspace.*"])
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await sendThrough(services.proxy.url)
      await services.settle()
      expect(services.state()).toMatchObject({
        inngest: { runs: [{ event: "evt_1", status: "completed" }] },
      })
    } finally {
      await services.close()
      dev.server.close()
    }
  }, 20_000)

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
async function sendThrough(
  proxyUrl: string,
  path = "/e/test-key",
  body: unknown = { name: "workspace.created" },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const target = new URL(proxyUrl)
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        method: "POST",
        path: `http://${INNGEST_HOST}${path}`,
        headers: { host: INNGEST_HOST, "content-type": "application/json" },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve())
      },
    )

    req.on("error", reject)
    req.end(JSON.stringify(body))
  })
}
