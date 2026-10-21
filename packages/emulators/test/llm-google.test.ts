import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GoogleGenAI } from "@google/genai"
import { embed, generateText, jsonSchema, Output, stepCountIs, streamText, tool } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, llmOutboundFaults, seedLlm } from "../src/llm/index.ts"
import { fakeKey } from "./fake-key.ts"
import { emulatorFetch, faultFetch } from "./llm-client.ts"

const KEY = fakeKey("AIza", "SyDanwoEmulatedKey00000000000000000")
const MODEL = "gemini-2.5-flash"

let emulator: Emulator

beforeEach(() => {
  emulator = createEmulator(llm)
  seedLlm(emulator.store, {
    prices: { [MODEL]: { input: 0.3, output: 2.5 } },
    scripts: [
      {
        match: { provider: "google", user: /weather in (\w+)/ },
        reply: [
          { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          { text: "It is 31°C and sunny in Lagos." },
        ],
      },
      { match: { provider: "google", user: /colour/ }, reply: { json: { colour: "teal" } } },
      { match: { provider: "google" }, reply: { text: "Hello from Gemini." } },
    ],
  })
})

function google(behaviour?: string) {
  return createGoogleGenerativeAI({ apiKey: KEY, fetch: emulatorFetch(emulator, behaviour) })
}

/** The native SDK, which calls the global fetch: stubbed here to answer from the emulator. */
function genai(): GoogleGenAI {
  vi.stubGlobal("fetch", emulatorFetch(emulator))

  return new GoogleGenAI({ apiKey: KEY })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const WEATHER = {
  weather: tool({
    description: "The weather in a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ city, celsius: 31 }),
  }),
}

describe("Gemini through the AI SDK", () => {
  it("generates text, counting tokens and cost", async () => {
    const result = await generateText({ model: google()(MODEL), prompt: "say hi" })

    expect(result.text).toBe("Hello from Gemini.")
    expect(result.finishReason).toBe("stop")
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(llmCalls(emulator).last()).toMatchObject({ provider: "google", model: MODEL })
    expect(llmCalls(emulator).cost()).toBeGreaterThan(0)
  })

  it("runs a tool loop: the scripted function call, its result, then the answer", async () => {
    const result = await generateText({
      model: google()(MODEL),
      tools: WEATHER,
      stopWhen: stepCountIs(3),
      prompt: "what is the weather in Lagos?",
    })

    expect(result.text).toBe("It is 31°C and sunny in Lagos.")
    expect(result.steps[0]?.toolResults[0]?.output).toEqual({ city: "Lagos", celsius: 31 })
    expect(llmCalls(emulator).all()[1]?.messages.at(-1)?.role).toBe("tool")
  })

  it("answers structured output with the scripted object", async () => {
    const result = await generateText({
      model: google()(MODEL),
      prompt: "Name one colour.",
      output: Output.object({
        schema: jsonSchema<{ colour: string }>({
          type: "object",
          properties: { colour: { type: "string" } },
          required: ["colour"],
        }),
      }),
    })

    expect(result.output).toEqual({ colour: "teal" })
  })

  it("streams text", async () => {
    const result = streamText({ model: google()(MODEL), prompt: "say hi" })
    let text = ""

    for await (const piece of result.textStream) text += piece

    expect(text).toBe("Hello from Gemini.")
    expect((await result.usage).outputTokens).toBeGreaterThan(0)
  })

  it("acts out a safety block, a cut-off answer and a malformed function call", async () => {
    const blocked = await generateText({
      model: google("content-filter")(MODEL),
      prompt: "say hi",
    })
    const cut = await generateText({ model: google("truncated")(MODEL), prompt: "say hi" })
    const malformed = await generateText({
      model: google("malformed-tool-call")(MODEL),
      tools: WEATHER,
      prompt: "what is the weather in Lagos?",
    })

    expect(blocked.finishReason).toBe("content-filter")
    expect(cut.finishReason).toBe("length")
    expect(malformed.toolCalls).toEqual([])
    expect(malformed.finishReason).not.toBe("tool-calls")
  })

  it("embeds the same text to the same vector", async () => {
    const model = google().textEmbeddingModel("gemini-embedding-001")
    const [a, b] = await Promise.all([
      embed({ model, value: "refund policy" }),
      embed({ model, value: "refund policy" }),
    ])

    expect(a.embedding).toHaveLength(3072)
    expect(b.embedding).toEqual(a.embedding)
  })

  it("parses a rate-limit fault the way it parses Google's own", async () => {
    const fault = llmOutboundFaults({
      host: "generativelanguage.googleapis.com",
      method: "POST",
      path: `/v1beta/models/${MODEL}:generateContent`,
    })[0]

    if (fault?.kind !== "status") throw new Error("expected a status fault first")

    const limited = createGoogleGenerativeAI({ apiKey: KEY, fetch: faultFetch(fault) })

    await expect(
      generateText({ model: limited(MODEL), prompt: "say hi", maxRetries: 0 }),
    ).rejects.toMatchObject({ statusCode: 429, message: expect.stringMatching(/quota/) })
  })
})

describe("Gemini through @google/genai", () => {
  it("generates, streams, counts tokens and embeds", async () => {
    const client = genai()
    const whole = await client.models.generateContent({ model: MODEL, contents: "say hi" })
    let streamed = ""

    for await (const chunk of await client.models.generateContentStream({
      model: MODEL,
      contents: "say hi",
    }))
      streamed += chunk.text ?? ""

    const counted = await client.models.countTokens({ model: MODEL, contents: "say hi" })
    const embedded = await client.models.embedContent({
      model: "gemini-embedding-001",
      contents: "refund policy",
    })

    expect(whole.text).toBe("Hello from Gemini.")
    expect(streamed).toBe("Hello from Gemini.")
    expect(counted.totalTokens).toBeGreaterThan(0)
    expect(embedded.embeddings?.[0]?.values).toHaveLength(3072)
  })

  it("refuses a call without a key as Google does", async () => {
    const response = await emulator.fetch(
      new Request(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
        },
      ),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 403, status: "PERMISSION_DENIED" },
    })
  })
})
