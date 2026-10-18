import { createGateway, embed, generateText, stepCountIs, streamText, tool } from "ai"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, seedLlm } from "../src/llm/index.ts"
import { emulatorFetch } from "./llm-client.ts"

let emulator: Emulator

beforeEach(() => {
  emulator = createEmulator(llm)
  seedLlm(emulator.store, {
    prices: { "anthropic/claude-sonnet-5": { input: 3, output: 15 } },
    scripts: [
      {
        match: { provider: "gateway", user: /weather in (\w+)/ },
        reply: [
          { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          { text: "It is 31°C and sunny in Lagos." },
        ],
      },
      { match: { provider: "gateway" }, reply: { text: "Hello from the gateway." } },
    ],
  })
})

function gatewayFor(behaviour?: string) {
  return createGateway({ apiKey: "vck_danwo_emulated", fetch: emulatorFetch(emulator, behaviour) })
}

const WEATHER = {
  weather: tool({
    description: "The weather in a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ city, celsius: 31 }),
  }),
}

describe("AI Gateway", () => {
  it("generates text, reporting the scripted price as gateway cost", async () => {
    const result = await generateText({
      model: gatewayFor()("anthropic/claude-sonnet-5"),
      prompt: "say hi",
    })

    expect(result.text).toBe("Hello from the gateway.")
    expect(Number(result.providerMetadata?.gateway?.cost)).toBeGreaterThan(0)
    expect(llmCalls(emulator).last()).toMatchObject({
      provider: "gateway",
      model: "anthropic/claude-sonnet-5",
    })
  })

  it("runs a tool loop: the scripted tool call, the tool's result, then the answer", async () => {
    const result = await generateText({
      model: gatewayFor()("openai/gpt-5-mini"),
      tools: WEATHER,
      stopWhen: stepCountIs(3),
      prompt: "what is the weather in Lagos?",
    })

    expect(result.text).toBe("It is 31°C and sunny in Lagos.")
    expect(result.steps[0]?.toolResults[0]?.output).toEqual({ city: "Lagos", celsius: 31 })
  })

  it("streams text", async () => {
    const result = streamText({ model: gatewayFor()("openai/gpt-5-mini"), prompt: "say hi" })
    let text = ""

    for await (const piece of result.textStream) text += piece

    expect(text).toBe("Hello from the gateway.")
  })

  it("acts out a content filter and a cut-off answer", async () => {
    const filtered = await generateText({
      model: gatewayFor("content-filter")("openai/gpt-5-mini"),
      prompt: "say hi",
    })
    const cut = await generateText({
      model: gatewayFor("truncated")("openai/gpt-5-mini"),
      prompt: "say hi",
    })

    expect(filtered.finishReason).toBe("content-filter")
    expect(cut.finishReason).toBe("length")
  })

  it("embeds the same text to the same vector", async () => {
    const model = gatewayFor().textEmbeddingModel("openai/text-embedding-3-small")
    const [a, b] = await Promise.all([
      embed({ model, value: "refund policy" }),
      embed({ model, value: "refund policy" }),
    ])

    expect(a.embedding).toHaveLength(1536)
    expect(b.embedding).toEqual(a.embedding)
  })
})
