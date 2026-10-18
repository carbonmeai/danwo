import OpenAI, { RateLimitError } from "openai"
import { beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, llmOutboundFaults, llmScripts, seedLlm } from "../src/llm/index.ts"
import { faultFetch, OPENAI_KEY, openaiClient } from "./llm-client.ts"

let emulator: Emulator

beforeEach(() => {
  emulator = createEmulator(llm)
  seedLlm(emulator.store, {
    prices: { "gpt-5-mini": { input: 1, output: 4 } },
    scripts: [
      {
        name: "greeting",
        match: { user: /hello/i },
        reply: { text: "Hi! How can I help with your order today?" },
      },
      {
        name: "refund",
        match: { user: /refund order (\d+)/, tool: "issue_refund" },
        reply: [
          { toolCalls: [{ name: "issue_refund", arguments: { order: 42, amount: 1500 } }] },
          { text: "Your refund of $15.00 is on its way." },
        ],
      },
    ],
  })
})

const REFUND_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "issue_refund",
      parameters: { type: "object", properties: { order: { type: "number" } } },
    },
  },
]

describe("Chat Completions", () => {
  it("answers from a script, with usage, and logs the call with its cost", async () => {
    const completion = await openaiClient(emulator).chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "You are a support agent." },
        { role: "user", content: "Hello there" },
      ],
    })

    expect(completion.choices[0]?.message.content).toBe("Hi! How can I help with your order today?")
    expect(completion.choices[0]?.finish_reason).toBe("stop")
    expect(completion.usage?.completion_tokens).toBe(11)

    const call = llmCalls(emulator).last()

    expect(call).toMatchObject({
      provider: "openai",
      api: "chat",
      system: "You are a support agent.",
      script: "greeting",
    })
    expect(call?.cost).toBeCloseTo(((call?.usage.input ?? 0) + 4 * 11) / 1_000_000, 12)
  })

  it("calls a tool, then answers once the tool result comes back", async () => {
    const client = openaiClient(emulator)
    const asked: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "user", content: "Please refund order 42" },
    ]
    const first = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: asked,
      tools: REFUND_TOOLS,
    })
    const call = first.choices[0]?.message.tool_calls?.[0]

    expect(first.choices[0]?.finish_reason).toBe("tool_calls")
    expect(call?.type === "function" && JSON.parse(call.function.arguments)).toEqual({
      order: 42,
      amount: 1500,
    })

    const second = await client.chat.completions.create({
      model: "gpt-5-mini",
      tools: REFUND_TOOLS,
      messages: [
        ...asked,
        first.choices[0]?.message ?? { role: "assistant", content: "" },
        { role: "tool", tool_call_id: call?.id ?? "", content: "refunded" },
      ],
    })

    expect(second.choices[0]?.message.content).toBe("Your refund of $15.00 is on its way.")
  })

  it("streams text and tool call deltas, with a final usage chunk", async () => {
    const stream = await openaiClient(emulator).chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "Please refund order 42" }],
      tools: REFUND_TOOLS,
      stream: true,
      stream_options: { include_usage: true },
    })
    let args = ""
    let finish: string | null = null
    let usage = 0

    for await (const chunk of stream) {
      args += chunk.choices[0]?.delta.tool_calls?.[0]?.function?.arguments ?? ""
      finish = chunk.choices[0]?.finish_reason ?? finish
      usage = chunk.usage?.total_tokens ?? usage
    }

    expect(JSON.parse(args)).toEqual({ order: 42, amount: 1500 })
    expect(finish).toBe("tool_calls")
    expect(usage).toBeGreaterThan(0)
  })

  it("returns a structured answer that fits the schema, and refuses one that does not", async () => {
    llmScripts(emulator).add({
      match: { user: /classify/ },
      reply: [{ json: { sentiment: "positive", score: 0.9 } }, { json: { sentiment: 3 } }],
    })

    const format = {
      type: "json_schema" as const,
      json_schema: {
        name: "verdict",
        schema: {
          type: "object",
          properties: { sentiment: { type: "string" }, score: { type: "number" } },
          required: ["sentiment", "score"],
          additionalProperties: false,
        },
      },
    }
    const client = openaiClient(emulator)
    const ask = () =>
      client.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "classify: great service" }],
        response_format: format,
      })
    const good = await ask()

    expect(JSON.parse(good.choices[0]?.message.content ?? "")).toEqual({
      sentiment: "positive",
      score: 0.9,
    })
    await expect(ask()).rejects.toThrow(
      /\$\.score is required.*\$\.sentiment must be "string"|\$\.sentiment must be "string".*\$\.score is required/,
    )
  })

  it("echoes an unscripted call, marked, or fails it when the seed is strict", async () => {
    const reply = await openaiClient(emulator).chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "what is the weather" }],
    })

    expect(reply.choices[0]?.message.content).toBe("[danwo: unscripted] what is the weather")

    emulator.reset()
    seedLlm(emulator.store, { unscripted: "fail" })

    await expect(
      openaiClient(emulator).chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: "what is the weather" }],
      }),
    ).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/no script answers/) })
  })

  it("refuses a call without a key, in OpenAI's error shape", async () => {
    const response = await emulator.fetch(
      new Request("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5-mini", messages: [] }),
      }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { type: "invalid_request_error" } })
  })
})

describe("Responses API", () => {
  it("answers whole, and streamed as typed events", async () => {
    const client = openaiClient(emulator)
    const whole = await client.responses.create({ model: "gpt-5-mini", input: "hello" })

    expect(whole.output_text).toBe("Hi! How can I help with your order today?")
    expect(whole.status).toBe("completed")

    const stream = await client.responses.create({
      model: "gpt-5-mini",
      input: "hello",
      stream: true,
    })
    let text = ""
    let completed = false

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") text += event.delta
      if (event.type === "response.completed") completed = true
    }

    expect(text).toBe("Hi! How can I help with your order today?")
    expect(completed).toBe(true)
  })

  it("calls a function tool", async () => {
    const reply = await openaiClient(emulator).responses.create({
      model: "gpt-5-mini",
      input: "Please refund order 42",
      tools: [{ type: "function", name: "issue_refund", parameters: {}, strict: false }],
    })
    const call = reply.output.find((item) => item.type === "function_call")

    expect(call?.type === "function_call" && call.name).toBe("issue_refund")
  })
})

describe("embeddings", () => {
  it("gives the same unit vector for the same text, of the asked width", async () => {
    const client = openaiClient(emulator)
    const ask = (input: string) =>
      client.embeddings.create({ model: "text-embedding-3-small", input, dimensions: 64 })
    const [a, b, c] = await Promise.all([
      ask("refund policy"),
      ask("refund policy"),
      ask("shipping"),
    ])
    const vector = a.data[0]?.embedding ?? []

    expect(vector).toHaveLength(64)
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6)
    expect(b.data[0]?.embedding).toEqual(vector)
    expect(c.data[0]?.embedding).not.toEqual(vector)
  })
})

/** Asks for the refund with the emulator told to act out `behaviour`. */
function askRefund(behaviour: string) {
  return openaiClient(emulator, behaviour).chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Please refund order 42" }],
    tools: REFUND_TOOLS,
  })
}

describe("emulated faults", () => {
  it("refuses, answers empty, truncates and filters on request", async () => {
    expect((await askRefund("refusal")).choices[0]?.message.refusal).toMatch(/can't help/)
    expect((await askRefund("empty-completion")).choices[0]?.message.content).toBe("")
    expect((await askRefund("truncated")).choices[0]?.finish_reason).toBe("length")
    expect((await askRefund("content-filter")).choices[0]?.finish_reason).toBe("content_filter")
    expect(
      llmCalls(emulator)
        .all()
        .map((call) => call.fault),
    ).toEqual(["refusal", "empty-completion", "truncated", "content-filter"])
  })

  it("sends a tool call whose arguments are not JSON", async () => {
    const call = (await askRefund("malformed-tool-call")).choices[0]?.message.tool_calls?.[0]
    const args = call?.type === "function" ? call.function.arguments : ""

    expect(() => JSON.parse(args)).toThrow(SyntaxError)
  })

  it("cuts a stream short, with no finish reason and no end marker", async () => {
    const stream = await openaiClient(emulator, "stream-cut").chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    })
    const finishes: Array<string | null | undefined> = []

    for await (const chunk of stream) finishes.push(chunk.choices[0]?.finish_reason)

    expect(finishes.every((finish) => finish == null)).toBe(true)
  })

  it("has rate limits the SDK reads as its own error, with OpenAI's headers", async () => {
    const faults = llmOutboundFaults({
      host: "api.openai.com",
      method: "POST",
      path: "/v1/chat/completions",
    })
    const limited = faults.find((fault) => fault.kind === "status" && fault.status === 429)

    if (limited?.kind !== "status") throw new Error("no 429 fault")

    const client = new OpenAI({ apiKey: OPENAI_KEY, fetch: faultFetch(limited), maxRetries: 0 })

    await expect(
      client.chat.completions.create({ model: "gpt-5-mini", messages: [] }),
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(limited.headers["x-ratelimit-remaining-requests"]).toBe("0")
    expect(
      faults.map((fault) => (fault.kind === "emulate" ? fault.behaviour : fault.kind)),
    ).toEqual([
      "status",
      "status",
      "status",
      "status",
      "delay",
      "reset",
      "reset-after",
      "refusal",
      "empty-completion",
      "truncated",
      "content-filter",
      "malformed-tool-call",
      "stream-cut",
    ])
  })
})
