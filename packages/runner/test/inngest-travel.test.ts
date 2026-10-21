import { once } from "node:events"
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http"

import { describe, expect, it } from "vitest"

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

/** A run the stand-in started for an invocation: its event, and when it began and ends. */
interface Invoked {
  readonly event: string
  readonly functionId: string
  readonly at: number
}

/**
 * A stand-in dev server with an hourly cron function and a yearly one, answering the GraphQL
 * calls settling and travel make: its functions, invoking one (a run that takes `runMs`), and
 * the runs of a function since a moment, with the events that started them.
 */
async function cronDevServer(runMs: number) {
  const invoked: Invoked[] = []
  const functions = [
    {
      id: "fn-hourly",
      slug: "digests-scheduler",
      triggers: [{ type: "CRON", value: "0 * * * *" }],
    },
    { id: "fn-yearly", slug: "digests-yearly", triggers: [{ type: "CRON", value: "@yearly" }] },
  ]
  const run = (entry: Invoked) => {
    const done = Date.now() - entry.at >= runMs

    return {
      run_id: `run_${entry.event}`,
      function_id: entry.functionId,
      status: done ? "Completed" : "Running",
      run_started_at: new Date(entry.at).toISOString(),
      ...(done && { ended_at: new Date(entry.at + runMs).toISOString() }),
    }
  }

  const answer = (body: string): unknown => {
    const { query, variables } = JSON.parse(body) as {
      query: string
      variables: { slug?: string; from?: string; functions?: string[] }
    }

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

    if (query.includes("runs(")) {
      const from = Date.parse(variables.from ?? "")
      const edges = invoked
        .filter((entry) => variables.functions?.includes(entry.functionId) && entry.at >= from)
        .map((entry) => ({ node: { triggerIDs: [entry.event] } }))

      return { data: { runs: { edges } } }
    }

    return { data: { functions } }
  }

  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (req.url === "/v0/gql") return json(res, answer(body))

      const event = /^\/v1\/events\/([^/]+)\/runs$/.exec(req.url ?? "")?.[1]
      const entry = invoked.find((e) => e.event === event)

      json(res, { data: entry ? [run(entry)] : [] })
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return { server, invoked, url: `http://127.0.0.1:${port}` }
}

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
