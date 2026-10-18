import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { createEmulator, LLM_HOSTS, llm, llmCalls, seedLlm } from "@danwo/emulators"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { startProxy } from "../src/proxy.ts"

const run = promisify(execFile)
const APP = fileURLToPath(new URL("./fixtures/llm-app.ts", import.meta.url))

const Output = z.object({ chat: z.string(), gateway: z.string(), steps: z.number() })

describe("model APIs behind the proxy", () => {
  it("answers an unmodified app's OpenAI and AI Gateway calls from scripts", async () => {
    const emulator = createEmulator(llm)

    seedLlm(emulator.store, {
      unscripted: "fail",
      scripts: [
        {
          match: { provider: "openai", system: /support/, user: /ship to (\w+)/ },
          reply: { text: "Yes, we ship to Ghana in 5 to 7 days." },
        },
        {
          match: { provider: "gateway", user: /umbrellas/, tool: "stock" },
          reply: [
            { toolCalls: [{ name: "stock", arguments: { item: "umbrella" } }] },
            { text: "There are 3 umbrellas in stock." },
          ],
        },
      ],
    })

    const proxy = await startProxy({
      routes: [{ hosts: LLM_HOSTS, handler: emulator.fetch }],
      unmatched: "block",
    })

    try {
      const { stdout } = await run(process.execPath, [APP], {
        env: {
          ...proxy.env(),
          OPENAI_API_KEY: "sk-test-app-key-000000000000",
          AI_GATEWAY_API_KEY: "vck_app_key_0000000000",
        },
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 30_000,
      })
      const out = Output.parse(JSON.parse(stdout))

      expect(out).toEqual({
        chat: "Yes, we ship to Ghana in 5 to 7 days.",
        gateway: "There are 3 umbrellas in stock.",
        steps: 2,
      })
      expect(
        llmCalls(emulator)
          .all()
          .map((call) => call.provider),
      ).toEqual(["openai", "gateway", "gateway"])

      await proxy.settled()
      expect(proxy.exchanges().every((exchange) => exchange.disposition === "routed")).toBe(true)
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  }, 60_000)
})
