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

describe("Inngest after a time travel", () => {
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
