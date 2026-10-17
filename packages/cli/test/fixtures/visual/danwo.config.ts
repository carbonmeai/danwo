import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { defineConfig } from "@danwo/sdk"

export default defineConfig({
  testDir: "tests",
  timeout: 20_000,
  /** A badge whose colour the test run sets, so a run can change how the page looks. */
  async environment() {
    const colour = process.env["DANWO_BADGE_COLOUR"] ?? "#2255aa"
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(`<!doctype html><title>Badge</title>
<div data-testid="badge" style="width:200px;height:60px;background:${colour}"></div>`)
    })

    server.listen(0, "127.0.0.1")
    await once(server, "listening")

    return {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      async close() {
        server.close()
      },
    }
  },
})
