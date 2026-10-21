import { createGateway, embed, generateText, stepCountIs, streamText, tool } from "ai"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, llmScripts, seedLlm } from "../src/llm/index.ts"
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

/** The error a bare gateway call saying `text` fails with, or its answer when it doesn't fail. */
function failure(text: string): Promise<unknown> {
  return Promise.resolve(
    gatewayFor()("openai/gpt-5-mini").doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text }] }],
    }),
  ).catch((error: unknown) => error)
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

  it("answers by what the tool handed back: its JSON, or its error", async () => {
    llmScripts(emulator).clear()
    seedLlm(emulator.store, {
      scripts: [
        {
          match: { user: /weather in (\w+)/, toolResult: false },
          reply: { toolCalls: [{ name: "weather", arguments: { city: "Atlantis" } }] },
        },
        { match: { toolResult: /no such city/ }, reply: { text: "I couldn't find that city." } },
        { match: { toolResult: /"celsius":31/ }, reply: { text: "It is 31°C." } },
      ],
    })

    const tools = {
      weather: tool({
        description: "The weather in a city",
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => {
          if (city === "Atlantis") throw new Error("no such city")

          return { city, celsius: 31 }
        },
      }),
    }
    const model = gatewayFor()("openai/gpt-5-mini")
    const failed = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(3),
      prompt: "what is the weather in Atlantis?",
    })

    expect(failed.text).toBe("I couldn't find that city.")

    llmScripts(emulator).clear()
    seedLlm(emulator.store, {
      scripts: [
        {
          match: { toolResult: false },
          reply: { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
        },
        { match: { toolResult: /no such city/ }, reply: { text: "I couldn't find that city." } },
        { match: { toolResult: /"celsius":31/ }, reply: { text: "It is 31°C." } },
      ],
    })

    const found = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(3),
      prompt: "what is the weather in Lagos?",
    })

    expect(found.text).toBe("It is 31°C.")
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

  it("breaks a malformed tool call's arguments off half-way, which the AI SDK refuses", async () => {
    const seen: string[] = []
    const result = await generateText({
      model: gatewayFor("malformed-tool-call")("openai/gpt-5-mini"),
      tools: WEATHER,
      prompt: "what is the weather in Lagos?",
      repairToolCall: async ({ toolCall }) => {
        seen.push(toolCall.input)

        return null
      },
    })
    const [input = ""] = seen

    expect(result.toolResults).toEqual([])
    expect(input.length).toBeGreaterThan(2)
    expect('{"city":"Lagos"}'.startsWith(input)).toBe(true)
    expect(() => JSON.parse(input)).toThrow(SyntaxError)
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

  it("answers a scripted rate limit in the gateway's shape, which the AI SDK retries", async () => {
    llmScripts(emulator).clear()
    seedLlm(emulator.store, {
      scripts: [
        {
          match: { user: /busy/ },
          reply: [{ error: "rate-limit" }, { text: "Here now." }],
        },
      ],
    })

    const result = await generateText({
      model: gatewayFor()("openai/gpt-5-mini"),
      prompt: "are you busy?",
      maxRetries: 1,
    })

    expect(result.text).toBe("Here now.")
    expect(
      llmCalls(emulator)
        .all()
        .map((call) => call.reply.error ?? null),
    ).toEqual(["rate-limit", null])
  })

  it("answers scripted outages with the gateway's status and error type", async () => {
    llmScripts(emulator).clear()
    seedLlm(emulator.store, {
      scripts: [
        { match: { user: /down/ }, reply: { error: "server-error" } },
        { match: { user: /full/ }, reply: { error: "overloaded" } },
      ],
    })

    const down = await failure("down?")
    const full = await failure("full?")

    expect(down).toMatchObject({ statusCode: 500, type: "internal_server_error" })
    expect(full).toMatchObject({ statusCode: 503 })
  })

  it("refuses an unlisted model as the gateway does, when asked to", async () => {
    seedLlm(emulator.store, { models: ["openai/gpt-5-mini"], knownModelsOnly: true })

    await expect(
      generateText({ model: gatewayFor()("openai/no-such-model"), prompt: "say hi" }),
    ).rejects.toThrow(/not found/)
  })
})
