// A one-page app per worker for the CLI's integration tests.
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import type { WorkerEnvironment } from "@danwo/sdk"

export async function pageEnvironment(workerIndex: number): Promise<WorkerEnvironment> {
  let hits = 0
  const server = createServer((_req, res) => {
    hits += 1
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html><title>Fixture</title><h1>Worker ${workerIndex}</h1>`)
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    fixtures: { hits: () => hits },
    async close() {
      server.close()
    },
  }
}
