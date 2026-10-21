import { once } from "node:events"
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http"

import { describe, expect, it } from "vitest"
import { z } from "zod"

import { inngestService, INNGEST_HOST } from "../src/runner/inngest.ts"
import { startServices } from "../src/runner/services.ts"

const DAY = 24 * 60 * 60 * 1000

/** What the stand-in dev server was sent at `POST /e/<key>`: the body and the id seed header. */
interface Received {
  readonly body: string
  readonly seed: string | undefined
}

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value))
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  let body = ""

  for await (const chunk of req) body += String(chunk)

  return body
}

/** A stand-in dev server that keeps every event send, starts no runs and has no functions. */
async function devServer() {
  const received: Received[] = []
  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (req.method === "POST" && req.url?.startsWith("/e/")) {
        const seed = req.headers["x-inngest-event-id-seed"]

        received.push({ body, seed: typeof seed === "string" ? seed : undefined })
        json(res, { ids: [`evt_${received.length}`] })
      } else json(res, { data: { functions: [] } })
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, received, url: `http://127.0.0.1:${port}` }
}

/** Sends `body` to the Inngest host through the proxy, as an app's SDK would. */
async function send(proxyUrl: string, body: string, headers: Record<string, string> = {}) {
  await new Promise<void>((resolve, reject) => {
    const target = new URL(proxyUrl)
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        method: "POST",
        path: `http://${INNGEST_HOST}/e/dev`,
        headers: { host: INNGEST_HOST, "content-type": "application/json", ...headers },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve())
      },
    )

    req.on("error", reject)
    req.end(body)
  })
}

/** A run a stand-in started: the event that started it, its function, and when it began. */
interface Started {
  readonly event: string
  readonly functionId: string
  readonly at: number
}

/** `started` as the dev server's runs API lists it: running for `runMs`, then `outcome`. */
function listed(started: Started, runMs: number, outcome = "Completed") {
  const done = Date.now() - started.at >= runMs

  return {
    run_id: `run_${started.event}`,
    function_id: started.functionId,
    status: done ? outcome : "Running",
    run_started_at: new Date(started.at).toISOString(),
    ...(done && { ended_at: new Date(started.at + runMs).toISOString() }),
  }
}

/** A GraphQL call settling and travel make. */
const Gql = z.object({
  query: z.string(),
  variables: z
    .object({
      id: z.string().optional(),
      slug: z.string().optional(),
      from: z.string().optional(),
      functions: z.array(z.string()).optional(),
    })
    .default({}),
})

/** The edges of a `runs` answer for `started`, those of the asked functions since `from`. */
function runEdges(started: readonly Started[], variables: z.infer<typeof Gql>["variables"]) {
  const from = Date.parse(variables.from ?? "")
  const edges = started
    .filter((entry) => variables.functions?.includes(entry.functionId) && entry.at >= from)
    .map((entry) => ({ node: { triggerIDs: [entry.event] } }))

  return { data: { runs: { edges } } }
}

/**
 * A stand-in dev server with an hourly cron function and a yearly one, answering the GraphQL
 * calls settling and travel make: its functions, invoking one (a run that takes `runMs`), and
 * the runs of a function since a moment, with the events that started them.
 */
async function cronDevServer(runMs: number) {
  const invoked: Started[] = []
  const functions = [
    {
      id: "fn-hourly",
      slug: "digests-scheduler",
      triggers: [{ type: "CRON", value: "0 * * * *" }],
    },
    { id: "fn-yearly", slug: "digests-yearly", triggers: [{ type: "CRON", value: "@yearly" }] },
  ]

  const answer = (body: string): unknown => {
    const { query, variables } = Gql.parse(JSON.parse(body))

    if (query.includes("invokeFunction")) {
      const fn = functions.find((f) => f.slug === variables.slug)

      if (fn)
        invoked.push({
          event: `evt_invoke_${invoked.length + 1}`,
          functionId: fn.id,
          at: Date.now(),
        })

      return { data: { invokeFunction: fn !== undefined } }
    }

    if (query.includes("runs(")) return runEdges(invoked, variables)

    return { data: { functions } }
  }

  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (req.url === "/v0/gql") return json(res, answer(body))

      const event = /^\/v1\/events\/([^/]+)\/runs$/.exec(req.url ?? "")?.[1]
      const entry = invoked.find((e) => e.event === event)

      json(res, { data: entry ? [listed(entry, runMs)] : [] })
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, invoked, url: `http://127.0.0.1:${port}` }
}

/**
 * A stand-in dev server whose one function fails every run `runMs` after its event, and whose
 * `onFailure` handler then starts `lagMs` later, with an event of the dev server's own, and takes
 * `runMs` too.
 */
async function failingDevServer(runMs: number, lagMs: number) {
  const entries: Started[] = []
  const functions = [
    {
      id: "fn-send",
      slug: "digests-send-one",
      triggers: [{ type: "EVENT", value: "digest/send-one" }],
      failureHandler: { id: "fn-send-failure" },
    },
    {
      id: "fn-send-failure",
      slug: "digests-send-one-failure",
      triggers: [{ type: "EVENT", value: "inngest/function.failed" }],
      failureHandler: null,
    },
  ]

  /* A failed run's handler is queued `lagMs` after the run failed. */
  const handlerRuns = (): Started[] =>
    entries
      .filter((entry) => Date.now() - entry.at >= runMs + lagMs)
      .map((entry) => ({
        event: `evt_failed_${entry.event}`,
        functionId: "fn-send-failure",
        at: entry.at + runMs + lagMs,
      }))

  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (req.method === "POST" && req.url?.startsWith("/e/")) {
        const event = `evt_${entries.length + 1}`

        entries.push({ event, functionId: "fn-send", at: Date.now() })

        return json(res, { ids: [event] })
      }

      if (req.url === "/v0/gql") {
        const { query, variables } = Gql.parse(JSON.parse(body))

        return json(
          res,
          query.includes("runs(") ? runEdges(handlerRuns(), variables) : { data: { functions } },
        )
      }

      const event = /^\/v1\/events\/([^/]+)\/runs$/.exec(req.url ?? "")?.[1]
      const sent = entries.find((e) => e.event === event)
      const handler = handlerRuns().find((e) => e.event === event)

      json(res, {
        data: [
          ...(sent ? [listed(sent, runMs, "Failed")] : []),
          ...(handler ? [listed(handler, runMs)] : []),
        ],
      })
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, url: `http://127.0.0.1:${port}` }
}

/**
 * A stand-in dev server whose REST API answers from a cache, as the real one does for 15 seconds,
 * so it never shows a run finishing; its GraphQL says how each run is at that moment.
 */
async function cachingDevServer(runMs: number) {
  const sent: Started[] = []
  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (req.method === "POST" && req.url?.startsWith("/e/")) {
        const event = `evt_${sent.length + 1}`

        sent.push({ event, functionId: "fn-send", at: Date.now() })

        return json(res, { ids: [event] })
      }

      if (req.url === "/v0/gql") {
        const { query, variables } = Gql.parse(JSON.parse(body))

        if (!query.includes("eventV2")) return json(res, { data: { functions: [] } })

        const entry = sent.find((e) => e.event === variables.id)

        if (!entry)
          return json(res, {
            errors: [{ message: `event not found: ${variables.id}` }],
            data: null,
          })

        const done = Date.now() - entry.at >= runMs
        const runs = [
          {
            id: `run_${entry.event}`,
            functionID: entry.functionId,
            status: done ? "COMPLETED" : "RUNNING",
            startedAt: new Date(entry.at).toISOString(),
            endedAt: new Date(done ? entry.at + runMs : entry.at).toISOString(),
          },
        ]

        return json(res, { data: { eventV2: { runs } } })
      }

      /* The cache still holds the first answer: the run queued, never started. */
      json(res, { data: [{ run_id: "run_cached", function_id: "fn-send", status: "Scheduled" }] })
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, url: `http://127.0.0.1:${port}` }
}

describe("Inngest runs", () => {
  it("reads how a run is now from GraphQL, not from the REST API's cache", async () => {
    const dev = await cachingDevServer(400)
    const inngest = await inngestService({ url: dev.url, settleTimeoutMs: 5_000 })
    const services = await startServices([inngest])

    try {
      await send(services.proxy.url, JSON.stringify({ name: "digest/send-one" }))

      const began = Date.now()
      const [line = ""] = await services.settle()

      expect(Date.now() - began).toBeLessThan(2_000)
      expect(line).toMatch(/fn-send completed in 0\.4 s$/)
    } finally {
      await services.close()
      dev.server.close()
    }
  })
})

describe("Inngest onFailure handlers", () => {
  it("waits for the handler a failed run starts, and lists it", async () => {
    const dev = await failingDevServer(300, 400)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      await send(services.proxy.url, JSON.stringify({ name: "digest/send-one" }))

      const began = Date.now()
      const lines = await services.settle()

      expect(Date.now() - began).toBeGreaterThanOrEqual(900)
      expect(lines).toEqual([
        expect.stringMatching(
          /^inngest · \d+\.\d s · digests-send-one failed in 0\.3 s · digests-send-one-failure completed in 0\.3 s$/,
        ),
      ])
    } finally {
      await services.close()
      dev.server.close()
    }
  }, 20_000)
})

describe("Inngest after a time travel", () => {
  it("runs each cron function that fell due on the way, once, and settles once it has run", async () => {
    const dev = await cronDevServer(600)
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      const newYear =
        new Date().getUTCFullYear() !== new Date(Date.now() + 2 * DAY).getUTCFullYear()

      await services.travel(2 * DAY)
      expect(dev.invoked.map((entry) => entry.functionId)).toEqual(
        newYear ? ["fn-hourly", "fn-yearly"] : ["fn-hourly"],
      )

      const began = Date.now()
      const [line = ""] = await services.settle()

      expect(Date.now() - began).toBeGreaterThanOrEqual(400)
      expect(line).toMatch(/^inngest · \d+\.\d s · digests-scheduler completed in 0\.6 s/)
      expect(services.state()).toMatchObject({
        inngest: { runs: [{ event: "evt_invoke_1", functionId: "digests-scheduler" }] },
      })
    } finally {
      await services.close()
      dev.server.close()
    }
  }, 20_000)

  it("sends the apps' events on with the real time they were sent at", async () => {
    const dev = await devServer()
    const inngest = await inngestService({ url: dev.url })
    const services = await startServices([inngest])

    try {
      const sentAt = Date.now()

      await send(services.proxy.url, JSON.stringify({ name: "before", ts: sentAt }))
      await services.travel(2 * DAY)

      /* The app's clock is two days ahead now, and the SDK stamps what it sends with it. */
      const ahead = sentAt + 2 * DAY

      await send(
        services.proxy.url,
        JSON.stringify([
          { name: "digest/send-one", ts: ahead, data: { n: 1 } },
          { name: "digest/send-one", data: { n: 2 } },
        ]),
        { "x-inngest-event-id-seed": `${ahead},c2VlZA==` },
      )

      expect(dev.received.map(({ body }) => JSON.parse(body) as unknown)).toEqual([
        { name: "before", ts: sentAt },
        [
          { name: "digest/send-one", ts: sentAt, data: { n: 1 } },
          { name: "digest/send-one", data: { n: 2 } },
        ],
      ])
      expect(dev.received[1]?.seed).toBe(`${sentAt},c2VlZA==`)
    } finally {
      await services.close()
      dev.server.close()
    }
  })
})
