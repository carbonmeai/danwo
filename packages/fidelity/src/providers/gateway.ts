/**
 * The Vercel AI Gateway's fidelity suite, driven through the AI SDK's own gateway provider so each
 * request is the one an app sends: plain text, a tool call, structured JSON output, a stream and
 * an embedding, plus the error bodies for an unknown model, a missing key and a malformed request.
 * Live runs use the cheapest models with a few output tokens, so a run costs a fraction of a cent.
 */
import { createGateway, type GatewayProvider } from "@ai-sdk/gateway"
import { llm, seedLlm } from "@danwo/emulators"
import { embed, generateText, jsonSchema, Output, streamText, tool } from "ai"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Answer, Scenario, ScenarioContext, StepOptions } from "../scenario.ts"
import { asJsonObject, type Json } from "../shape.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const KEY = "DANWO_FIDELITY_AI_GATEWAY_KEY"
const SHARED_KEY = "AI_GATEWAY_API_KEY"
const API = "https://ai-gateway.vercel.sh/v4/ai"
const LANGUAGE_MODEL = "openai/gpt-4.1-nano"
const EMBEDDING_MODEL = "openai/text-embedding-3-small"
const MAX_OUTPUT_TOKENS = 20

/** Values that are part of the protocol: content and event types, finish reasons, error types. */
const LITERALS = ["**.type", "finishReason.unified", "**.finishReason.unified", "error.type"]

/**
 * Objects whose keys depend on the upstream provider or on the gateway's routing for the call:
 * compared by being there, not by what they hold.
 */
const MAPS = [
  "**.providerMetadata.openai",
  "**.providerMetadata.gateway.routing",
  "**.usage.raw",
  "usage.raw",
  "content[].providerMetadata",
  "**.param",
]

const SHAPES: StepOptions = { literals: LITERALS, maps: MAPS }

/** A response the AI SDK can read back, rebuilt from a recorded answer. */
function answerResponse(answer: Answer, events: boolean): Response {
  const headers = { "content-type": events ? "text/event-stream" : "application/json" }

  if (!events) return new Response(JSON.stringify(answer.body), { status: answer.status, headers })

  const lines = Object.values(asJsonObject(answer.body) ?? {}).flatMap((group) =>
    Array.isArray(group) ? group.map((event: Json) => `data: ${JSON.stringify(event)}\n\n`) : [],
  )

  return new Response(lines.join(""), { status: answer.status, headers })
}

/** The gateway provider, with each of its requests recorded as the step named `name`. */
function steppingGateway(context: ScenarioContext, name: string, events = false): GatewayProvider {
  return createGateway({
    apiKey: credential(context.target, "key"),
    fetch: async (input, init) => {
      const answer = await context.step(name, new Request(input, init), { ...SHAPES, events })

      return answerResponse(answer, events)
    },
  })
}

const text: Scenario = {
  name: "language model: text",
  async run(context) {
    const gateway = steppingGateway(context, "generate text")

    await generateText({
      model: gateway.languageModel(LANGUAGE_MODEL),
      prompt: "Reply with one word: hello.",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
  },
}

const weather = tool({
  description: "The weather in a city",
  inputSchema: jsonSchema<{ city: string }>({
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  }),
  execute: async () => "sunny",
})

const toolCall: Scenario = {
  name: "language model: tool call",
  documentedFacts: [{ name: "finish reason", value: "tool-calls" }],
  async run(context) {
    const gateway = steppingGateway(context, "call a tool")
    const result = await generateText({
      model: gateway.languageModel(LANGUAGE_MODEL),
      prompt: "What is the weather in Lagos? Use the tool.",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      tools: { weather },
      toolChoice: "required",
    })

    context.fact("finish reason", result.finishReason)
  },
}

const structured: Scenario = {
  name: "language model: structured output",
  documentedFacts: [{ name: "output matches the schema", value: true }],
  async run(context) {
    const gateway = steppingGateway(context, "generate json")
    const result = await generateText({
      model: gateway.languageModel(LANGUAGE_MODEL),
      prompt: "Name one colour.",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      output: Output.object({
        schema: jsonSchema<{ colour: string }>({
          type: "object",
          properties: { colour: { type: "string" } },
          required: ["colour"],
          additionalProperties: false,
        }),
      }),
    })

    context.fact("output matches the schema", typeof result.output.colour === "string")
  },
}

const streaming: Scenario = {
  name: "language model: stream",
  documentedFacts: [
    {
      name: "event types",
      value: "stream-start,response-metadata,text-start,text-delta,text-end,finish",
    },
  ],
  async run(context) {
    let types = ""
    const gateway = createGateway({
      apiKey: credential(context.target, "key"),
      fetch: async (input, init) => {
        const answer = await context.step("stream text", new Request(input, init), {
          ...SHAPES,
          events: true,
        })

        types = Object.keys(asJsonObject(answer.body) ?? {}).join(",")

        return answerResponse(answer, true)
      },
    })
    const result = streamText({
      model: gateway.languageModel(LANGUAGE_MODEL),
      prompt: "Count to three.",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })

    for await (const part of result.fullStream) void part

    context.fact("event types", types)
  },
}

const embedding: Scenario = {
  name: "embedding model",
  async run(context) {
    const gateway = steppingGateway(context, "embed")

    await embed({ model: gateway.embeddingModel(EMBEDDING_MODEL), value: "hello" })
  },
}

/** A raw language model request, the way the gateway provider frames one, for error answers. */
function rawRequest(model: string, body: unknown, key?: string): Request {
  return new Request(`${API}/language-model`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ai-gateway-protocol-version": "0.0.1",
      "ai-gateway-auth-method": "api-key",
      "ai-language-model-specification-version": "4",
      "ai-language-model-id": model,
      "ai-language-model-streaming": "false",
      ...(key !== undefined && { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify(body),
  })
}

const PROMPT = {
  prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  maxOutputTokens: 4,
}

const errors: Scenario = {
  name: "errors: unknown model, missing key, malformed request",
  async run(context) {
    const key = credential(context.target, "key")

    await context.step(
      "an unknown model",
      rawRequest("openai/no-such-model-danwo", PROMPT, key),
      SHAPES,
    )
    await context.step("no key", rawRequest(LANGUAGE_MODEL, PROMPT), SHAPES)
    await context.step(
      "a prompt that is not a list",
      rawRequest(LANGUAGE_MODEL, { prompt: "not a list" }, key),
      SHAPES,
    )
  },
}

export const gatewayFidelity: FidelityProvider = {
  name: "gateway",
  credentials: [
    {
      name: KEY,
      description: `an AI Gateway API key (${SHARED_KEY} is used when this is unset); a live run costs a fraction of a cent`,
    },
  ],
  scenarios: [text, toolCall, structured, streaming, embedding, errors],
  emulator: () =>
    emulatorTarget(llm, { key: "danwo-fidelity-gateway" }, (emulator) => {
      seedLlm(emulator.store, {
        models: [LANGUAGE_MODEL, EMBEDDING_MODEL],
        knownModelsOnly: true,
        prices: { [LANGUAGE_MODEL]: { input: 0.1, output: 0.4 } },
        scripts: [
          {
            match: { tool: "weather" },
            reply: { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          },
          { match: { user: "colour" }, reply: { json: { colour: "blue" } } },
        ],
      })
    }),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY] ?? env[SHARED_KEY]?.trim()

    return key === undefined || key === "" ? undefined : liveTarget({ key })
  },
}
