import { fileURLToPath } from "node:url"

import { defineConfig, llmEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

export default defineConfig({
  testDir: "tests",
  timeout: 40_000,
  async environment() {
    const port = await freePort()
    const llm = await llmEnvironment({
      seed: {
        unscripted: "fail",
        scripts: [
          {
            name: "refund tool call",
            match: { user: /refund order/i, tool: "issue_refund", toolResult: false },
            reply: { toolCalls: [{ name: "issue_refund", arguments: { order: 42 } }] },
          },
          {
            name: "refund reply",
            match: { toolResult: true },
            reply: { text: "Done! Order 42 has been refunded." },
          },
        ],
      },
    })

    const start = () =>
      launchApp(APP, port, {
        ...llm.proxy.env(),
        OPENAI_API_KEY: "sk-test-support-bot-0000000000",
        ...(process.env.SUPPORT_BUG && { SUPPORT_BUG: process.env.SUPPORT_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: llm.proxy,
      webhooks: llm.webhooks,
      fixtures: llm.fixtures,
      settle: llm.settle,
      async reset() {
        app.kill()
        await llm.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await llm.close()
      },
    }
  },
})
