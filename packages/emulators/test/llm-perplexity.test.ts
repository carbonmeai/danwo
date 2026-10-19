import { createPerplexity } from "@ai-sdk/perplexity"
import { generateText, jsonSchema, Output, stepCountIs, streamText, tool } from "ai"
import OpenAI from "openai"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, llmOutboundFaults, seedLlm } from "../src/llm/index.ts"
import { emulatorFetch, faultFetch } from "./llm-client.ts"

const KEY = "pplx-danwoEmulatedKey00000000000000"
const MODEL = "sonar-pro"

const SOURCES = [
  { url: "https://example.com/rates", title: "Exchange rates today", date: "2026-10-01" },
  { url: "https://example.org/naira", title: "The naira this week" },
]

let emulator: Emulator

beforeEach(() => {
  emulator = createEmulator(llm)
  seedLlm(emulator.store, {
    prices: { [MODEL]: { input: 3, output: 15 } },
    scripts: [
      {
        match: { provider: "perplexity", user: /weather in (\w+)/ },
        reply: [
          { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          { text: "It is 31°C and sunny in Lagos." },
        ],
      },
      { match: { provider: "perplexity", user: /colour/ }, reply: { json: { colour: "teal" } } },
      {
        match: { provider: "perplexity" },
        reply: { text: "The naira traded at 1,500 to the dollar [1][2].", sources: SOURCES },
      },
    ],
  })
})

function perplexity(behaviour?: string) {
  return createPerplexity({ apiKey: KEY, fetch: emulatorFetch(emulator, behaviour) })
}

/** The OpenAI client pointed at Sonar, as Perplexity's docs suggest for its chat API. */
function sonar(): OpenAI {
  return new OpenAI({
    apiKey: KEY,
    baseURL: "https://api.perplexity.ai",
    fetch: emulatorFetch(emulator),
    maxRetries: 0,
  })
}

/** A field the client's types leave out, such as Sonar's citations. */
function field(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

const WEATHER = {
  weather: tool({
    description: "The weather in a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ city, celsius: 31 }),
  }),
}

describe("Perplexity's Agent API through the AI SDK", () => {
  it("answers with the scripted sources, cost and search usage", async () => {
    const result = await generateText({ model: perplexity()(MODEL), prompt: "naira rate?" })

    expect(result.text).toContain("1,500")
    expect(result.sources.map((source) => source.sourceType === "url" && source.url)).toEqual(
      SOURCES.map((source) => source.url),
    )
    expect(result.providerMetadata?.perplexity?.cost).toMatchObject({ currency: "USD" })
    expect(llmCalls(emulator).last()).toMatchObject({ provider: "perplexity", api: "agent" })
  })

  it("runs a tool loop and answers structured output", async () => {
    const looped = await generateText({
      model: perplexity()(MODEL),
      tools: WEATHER,
      stopWhen: stepCountIs(3),
      prompt: "what is the weather in Lagos?",
    })
    const structured = await generateText({
      model: perplexity()(MODEL),
      prompt: "Name one colour.",
      output: Output.object({
        schema: jsonSchema<{ colour: string }>({
          type: "object",
          properties: { colour: { type: "string" } },
          required: ["colour"],
        }),
      }),
    })

    expect(looped.text).toBe("It is 31°C and sunny in Lagos.")
    expect(structured.output).toEqual({ colour: "teal" })
  })

  it("streams the answer and its sources", async () => {
    const result = streamText({ model: perplexity()(MODEL), prompt: "naira rate?" })
    let text = ""

    for await (const piece of result.textStream) text += piece

    expect(text).toContain("1,500")
    expect((await result.sources).length).toBe(2)
    expect(await result.finishReason).toBe("stop")
  })

  it("acts out a cut-off answer and parses a rate-limit fault", async () => {
    const cut = await generateText({ model: perplexity("truncated")(MODEL), prompt: "hi" })
    const fault = llmOutboundFaults({
      host: "api.perplexity.ai",
      method: "POST",
      path: "/v1/agent",
    })[0]

    if (fault?.kind !== "status") throw new Error("expected a status fault first")

    const limited = createPerplexity({ apiKey: KEY, fetch: faultFetch(fault) })

    expect(cut.finishReason).toBe("length")
    await expect(
      generateText({ model: limited(MODEL), prompt: "hi", maxRetries: 0 }),
    ).rejects.toMatchObject({ statusCode: 429 })
  })
})

describe("Perplexity's Sonar API", () => {
  it("answers a chat completion with citations and search results", async () => {
    const answer = await sonar().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "naira rate?" }],
    })

    expect(answer.choices[0]?.message.content).toContain("1,500")
    expect(field(answer, "citations")).toEqual(SOURCES.map((source) => source.url))
    expect(field(answer, "search_results")).toHaveLength(2)
  })

  it("streams, each chunk citing the sources", async () => {
    const stream = await sonar().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "naira rate?" }],
      stream: true,
    })
    let text = ""
    let citations: unknown

    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta.content ?? ""
      citations = field(chunk, "citations")
    }

    expect(text).toContain("1,500")
    expect(citations).toEqual(SOURCES.map((source) => source.url))
  })

  it("answers at its older address, /chat/completions", async () => {
    const response = await emulator.fetch(
      new Request("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hi" }] }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      object: "chat.completion",
      citations: expect.any(Array),
    })
  })
})
