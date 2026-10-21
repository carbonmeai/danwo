/**
 * Google Gemini's fidelity suite (`generativelanguage.googleapis.com`): text, a function call,
 * structured output, a stream, token counting and embeddings, plus the answer to a call with no
 * key. Live runs use the smallest Flash model with a few output tokens; without a key the goldens
 * come from Google's published API description.
 */
import { llm, seedLlm } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, StepDoc, StepOptions } from "../scenario.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"
import { COLOUR_JSON_SCRIPT, WEATHER_TOOL_SCRIPT } from "./model-scripts.ts"

const KEY = "DANWO_FIDELITY_GEMINI_KEY"
const API = "https://generativelanguage.googleapis.com/v1beta"
const MODEL = "gemini-2.5-flash-lite"
const EMBEDDING_MODEL = "gemini-embedding-001"
const GENERATE = "post /v1beta/models/{model}:generateContent"

/** Values that are part of the protocol: finish reasons, roles, harm categories and error statuses. */
const LITERALS = [
  "candidates[].finishReason",
  "candidates[].content.role",
  "candidates[].safetyRatings[].category",
  "error.status",
]

/** Objects whose keys vary with the model and the call: compared by being there. */
const MAPS = ["candidates[].content.parts[].functionCall.args"]

const SHAPES: StepOptions = { literals: LITERALS, maps: MAPS }

/** Google's error envelope, which its description leaves out. */
const ERROR_DOC: StepDoc = {
  status: 403,
  schema: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "status"],
        properties: {
          code: { type: "number" },
          message: { type: "string" },
          status: { type: "string" },
          details: { type: "array" },
        },
      },
    },
  },
  literals: { "error.status": "PERMISSION_DENIED" },
}

function call(context: ScenarioContext, method: string, body: unknown, model = MODEL): Request {
  return new Request(`${API}/models/${model}:${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": credential(context.target, "key"),
    },
    body: JSON.stringify(body),
  })
}

const prompt = (text: string) => ({
  contents: [{ role: "user", parts: [{ text }] }],
  generationConfig: { maxOutputTokens: 20 },
})

const generate: Scenario = {
  name: "generate: text, a function call, structured output",
  async run(context) {
    await context.step(
      "generate text",
      call(context, "generateContent", prompt("Reply with one word: hello.")),
      { ...SHAPES, doc: { operation: GENERATE, status: 200 } },
    )
    await context.step(
      "call a function",
      call(context, "generateContent", {
        ...prompt("What is the weather in Lagos? Use the tool."),
        tools: [
          {
            functionDeclarations: [
              {
                name: "weather",
                description: "The weather in a city",
                parameters: {
                  type: "object",
                  properties: { city: { type: "string" } },
                  required: ["city"],
                },
              },
            ],
          },
        ],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
      }),
      { ...SHAPES, doc: { operation: GENERATE, status: 200 } },
    )
    await context.step(
      "generate json",
      call(context, "generateContent", {
        ...prompt("Name one colour."),
        generationConfig: {
          maxOutputTokens: 20,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { colour: { type: "STRING" } },
            required: ["colour"],
          },
        },
      }),
      { ...SHAPES, doc: { operation: GENERATE, status: 200 } },
    )
  },
}

const streaming: Scenario = {
  name: "stream text",
  async run(context) {
    const request = call(context, "streamGenerateContent", prompt("Count to three."))
    const url = new URL(request.url)

    url.searchParams.set("alt", "sse")
    await context.step("stream text", new Request(url, request), { ...SHAPES, events: true })
  },
}

const counting: Scenario = {
  name: "count tokens and embed",
  async run(context) {
    await context.step(
      "count tokens",
      call(context, "countTokens", { contents: prompt("hi").contents }),
      {
        ...SHAPES,
        doc: { operation: "post /v1beta/models/{model}:countTokens", status: 200 },
      },
    )
    await context.step(
      "embed",
      call(context, "embedContent", { content: { parts: [{ text: "hello" }] } }, EMBEDDING_MODEL),
      { ...SHAPES, doc: { operation: "post /v1beta/models/{model}:embedContent", status: 200 } },
    )
    await context.step(
      "embed a batch",
      call(
        context,
        "batchEmbedContents",
        {
          requests: [
            { model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text: "hello" }] } },
          ],
        },
        EMBEDDING_MODEL,
      ),
      {
        ...SHAPES,
        doc: { operation: "post /v1beta/models/{model}:batchEmbedContents", status: 200 },
      },
    )
  },
}

const errors: Scenario = {
  name: "errors: no key",
  async run(context) {
    await context.step(
      "no key",
      new Request(`${API}/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prompt("hi")),
      }),
      { ...SHAPES, doc: ERROR_DOC },
    )
  },
}

export const geminiFidelity: FidelityProvider = {
  name: "gemini",
  leaves: "nothing: model calls store nothing",
  credentials: [
    {
      name: KEY,
      description: "a Gemini API key from Google AI Studio; a live run costs a fraction of a cent",
    },
  ],
  openapi: "https://generativelanguage.googleapis.com/$discovery/OPENAPI3_0?version=v1beta",
  scenarios: [generate, streaming, counting, errors],
  emulator: () =>
    emulatorTarget(
      llm,
      { key: ["AIza", "DanwoFidelity0000000000000000000000"].join("") },
      (emulator) => {
        seedLlm(emulator.store, {
          models: [MODEL, EMBEDDING_MODEL],
          scripts: [WEATHER_TOOL_SCRIPT, COLOUR_JSON_SCRIPT],
        })
      },
    ),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY]

    return key === undefined ? undefined : liveTarget({ key })
  },
}
