import { fileURLToPath } from "node:url"

import { defineConfig, stackEnvironment } from "@danwo/sdk"

import { freePort } from "../app-process.ts"

/**
 * A team board behind the proxy, every outside host blocked. Its tests open a teammate's browser
 * beside their own, and the board's WebSocket goes through the proxy, so `danwo matrix` can drop
 * one person's socket and not the other's.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  readiness: "page",
  async environment() {
    const port = await freePort()

    return stackEnvironment({
      unmatched: "block",
      apps: [
        {
          name: "board",
          command: `node "${fileURLToPath(new URL("./board.ts", import.meta.url))}"`,
          url: `http://127.0.0.1:${port}`,
          ready: { log: "board listening" },
        },
      ],
    })
  },
})
