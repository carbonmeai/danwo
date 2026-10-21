import { Readable } from "node:stream"

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ThrottlingException,
} from "@aws-sdk/client-bedrock-runtime"
import { embed, generateText, jsonSchema, Output, stepCountIs, streamText, tool } from "ai"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, llmOutboundFaults, seedLlm } from "../src/llm/index.ts"
import { fakeKey } from "./fake-key.ts"
import { emulatorFetch } from "./llm-client.ts"

const REGION = "us-east-1"
const CLAUDE = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
const NOVA = "amazon.nova-lite-v1:0"
const CREDENTIALS = {
  accessKeyId: fakeKey("AKIA", "DANWOEMULATED000"),
  secretAccessKey: "danwo-emulated-secret",
}

let emulator: Emulator

beforeEach(() => {
  emulator = createEmulator(llm)
  seedLlm(emulator.store, {
    prices: { [CLAUDE]: { input: 3, output: 15 } },
    scripts: [
      {
        match: { provider: "bedrock", user: /weather in (\w+)/ },
        reply: [
          { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          { text: "It is 31°C and sunny in Lagos." },
        ],
      },
      { match: { provider: "bedrock", user: /colour/ }, reply: { json: { colour: "teal" } } },
      { match: { provider: "bedrock" }, reply: { text: "Hello from Bedrock." } },
    ],
  })
})

/** The AI SDK's Bedrock provider, signing with SigV4, or with a Bedrock API key when `apiKey` is set. */
function bedrock(options: { behaviour?: string; apiKey?: string } = {}) {
  return createAmazonBedrock({
    region: REGION,
    ...(options.apiKey === undefined ? CREDENTIALS : { apiKey: options.apiKey }),
    fetch: emulatorFetch(emulator, options.behaviour),
  })
}

/** A request handler for the AWS SDK that answers from the emulator in-process. */
function emulatorHandler(answer: (request: Request) => Promise<Response>) {
  return {
    async handle(request: {
      protocol: string
      hostname: string
      port?: number
      path: string
      query?: Record<string, unknown>
      method: string
      headers: Record<string, string>
      body?: unknown
    }) {
      const url = new URL(`${request.protocol}//${request.hostname}${request.path}`)
      const body =
        typeof request.body === "string" || request.body instanceof Uint8Array
          ? { body: new Uint8Array(Buffer.from(request.body)) }
          : {}
      const response = await answer(
        new Request(url, { method: request.method, headers: request.headers, ...body }),
      )

      return {
        response: {
          statusCode: response.status,
          reason: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: Readable.from(Buffer.from(await response.arrayBuffer())),
        },
      }
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs: () => ({}),
  }
}

function runtime(
  answer: (request: Request) => Promise<Response> = (request) => emulator.fetch(request),
) {
  return new BedrockRuntimeClient({
    region: REGION,
    credentials: CREDENTIALS,
    requestHandler: emulatorHandler(answer),
    maxAttempts: 1,
  })
}

const WEATHER = {
  weather: tool({
    description: "The weather in a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ city, celsius: 31 }),
  }),
}

describe("Bedrock through the AI SDK", () => {
  it("answers Converse signed with SigV4 and with an API key", async () => {
    const signed = await generateText({ model: bedrock()(CLAUDE), prompt: "say hi" })
    const keyed = await generateText({
      model: bedrock({ apiKey: fakeKey("ABSK", "ZGFud28tZW11bGF0ZWQta2V5LTAwMDAwMDAw") })(NOVA),
      prompt: "say hi",
    })

    expect(signed.text).toBe("Hello from Bedrock.")
    expect(keyed.text).toBe("Hello from Bedrock.")
    expect(
      llmCalls(emulator)
        .all()
        .map((call) => [call.api, call.model]),
    ).toEqual([
      ["converse", CLAUDE],
      ["converse", NOVA],
    ])
    expect(llmCalls(emulator).cost()).toBeGreaterThan(0)
  })

  it("runs a tool loop and answers structured output through the json tool", async () => {
    const looped = await generateText({
      model: bedrock()(NOVA),
      tools: WEATHER,
      stopWhen: stepCountIs(3),
      prompt: "what is the weather in Lagos?",
    })
    const structured = await generateText({
      model: bedrock()(NOVA),
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
    expect(looped.steps[0]?.toolResults[0]?.output).toEqual({ city: "Lagos", celsius: 31 })
    expect(structured.output).toEqual({ colour: "teal" })
  })

  it("streams ConverseStream's event stream, text and tool calls", async () => {
    const result = streamText({ model: bedrock()(CLAUDE), prompt: "say hi" })
    let text = ""

    for await (const piece of result.textStream) text += piece

    const tools = streamText({
      model: bedrock()(NOVA),
      tools: WEATHER,
      prompt: "what is the weather in Lagos?",
    })

    expect(text).toBe("Hello from Bedrock.")
    expect((await result.usage).outputTokens).toBeGreaterThan(0)
    expect((await tools.toolCalls)[0]).toMatchObject({
      toolName: "weather",
      input: { city: "Lagos" },
    })
  })

  it("acts out a content filter, a cut-off answer and a stream that stops", async () => {
    const filtered = await generateText({
      model: bedrock({ behaviour: "content-filter" })(NOVA),
      prompt: "say hi",
    })
    const cut = await generateText({
      model: bedrock({ behaviour: "truncated" })(NOVA),
      prompt: "say hi",
    })

    expect(filtered.finishReason).toBe("content-filter")
    expect(cut.finishReason).toBe("length")

    const stopped = streamText({
      model: bedrock({ behaviour: "stream-cut" })(NOVA),
      prompt: "say hi",
    })

    await expect(stopped.text).resolves.toBeDefined()
    expect(await stopped.finishReason).not.toBe("stop")
  })

  it("embeds with Titan the same text to the same vector", async () => {
    const model = bedrock().textEmbeddingModel("amazon.titan-embed-text-v2:0")
    const [a, b] = await Promise.all([
      embed({ model, value: "refund policy" }),
      embed({ model, value: "refund policy" }),
    ])

    expect(a.embedding).toHaveLength(1024)
    expect(b.embedding).toEqual(a.embedding)
  })
})

describe("Bedrock through the AWS SDK", () => {
  const messages = [{ role: "user" as const, content: [{ text: "say hi" }] }]

  it("answers Converse and ConverseStream", async () => {
    const client = runtime()
    const whole = await client.send(new ConverseCommand({ modelId: NOVA, messages }))
    const streamed = await client.send(new ConverseStreamCommand({ modelId: NOVA, messages }))
    let text = ""
    let stop: string | undefined

    for await (const event of streamed.stream ?? []) {
      text += event.contentBlockDelta?.delta?.text ?? ""
      stop = event.messageStop?.stopReason ?? stop
    }

    expect(whole.output?.message?.content?.[0]?.text).toBe("Hello from Bedrock.")
    expect(whole.usage?.totalTokens).toBeGreaterThan(0)
    expect(text).toBe("Hello from Bedrock.")
    expect(stop).toBe("end_turn")
  })

  it("answers InvokeModel and its stream in Claude's Messages shape", async () => {
    const client = runtime()
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 100,
      messages: [{ role: "user", content: "say hi" }],
    })
    const whole = await client.send(new InvokeModelCommand({ modelId: CLAUDE, body }))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(whole.body))
    const streamed = await client.send(
      new InvokeModelWithResponseStreamCommand({ modelId: CLAUDE, body }),
    )
    const types: string[] = []

    for await (const event of streamed.body ?? []) {
      const bytes = event.chunk?.bytes

      if (bytes !== undefined) {
        const chunk: unknown = JSON.parse(new TextDecoder().decode(bytes))

        types.push(String(Object.getOwnPropertyDescriptor(chunk, "type")?.value))
      }
    }

    expect(parsed).toMatchObject({
      type: "message",
      content: [{ type: "text", text: "Hello from Bedrock." }],
    })
    expect(types[0]).toBe("message_start")
    expect(types.at(-1)).toBe("message_stop")
  })

  it("raises a throttling fault as the SDK's own ThrottlingException", async () => {
    const fault = llmOutboundFaults({
      host: `bedrock-runtime.${REGION}.amazonaws.com`,
      method: "POST",
      path: `/model/${encodeURIComponent(NOVA)}/converse`,
    })[0]

    if (fault?.kind !== "status") throw new Error("expected a status fault first")

    const client = runtime(
      async () => new Response(fault.body, { status: fault.status, headers: fault.headers }),
    )

    await expect(
      client.send(new ConverseCommand({ modelId: NOVA, messages })),
    ).rejects.toBeInstanceOf(ThrottlingException)
  })

  it("refuses an unsigned call as Bedrock does", async () => {
    const response = await emulator.fetch(
      new Request(`https://bedrock-runtime.${REGION}.amazonaws.com/model/${NOVA}/converse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("x-amzn-errortype")).toBe("AccessDeniedException")
    expect(await response.json()).toEqual({ message: "Missing Authentication Token" })
  })
})
