/**
 * Perplexity's fidelity suite (`api.perplexity.ai`): the Agent API's text, function call,
 * structured output and stream, Sonar's chat completion with citations, and the answer to a call
 * with no key. Live runs use the cheapest Sonar model with a few output tokens; without a key the
 * goldens come from Perplexity's published API description.
 */
import { llm, seedLlm } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, StepDoc, StepOptions } from "../scenario.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const KEY = "DANWO_FIDELITY_PERPLEXITY_KEY"
const API = "https://api.perplexity.ai"
const MODEL = "sonar"
const AGENT = { operation: "post /v1/agent", status: 200 } as const satisfies StepDoc

/** Values that are part of the protocol: object types, statuses, item and content types. */
const LITERALS = [
  "object",
  "status",
  "output[].type",
  "output[].content[].type",
  "choices[].finish_reason",
  "error.type",
]

/** Objects whose keys vary with the model and the call: compared by being there. */
const MAPS = ["usage.cost", "usage.tool_calls_details"]

const SHAPES: StepOptions = { literals: LITERALS, maps: MAPS }

const ERROR_DOC: StepDoc = {
  status: 401,
  schema: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["message", "type"],
        properties: {
          message: { type: "string" },
          type: { type: "string" },
          code: { type: ["string", "integer", "null"] },
        },
      },
    },
  },
}

function call(context: ScenarioContext, path: string, body: unknown): Request {
  return new Request(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential(context.target, "key")}`,
    },
    body: JSON.stringify(body),
  })
}

const agent: Scenario = {
  name: "agent: text, a function call, structured output, a stream",
  async run(context) {
    const ask = { model: MODEL, max_output_tokens: 20 }

    await context.step("answer", call(context, "/v1/agent", { ...ask, input: "Reply: hello." }), {
      ...SHAPES,
      doc: AGENT,
    })
    await context.step(
      "call a function",
      call(context, "/v1/agent", {
        ...ask,
        input: "What is the weather in Lagos? Use the tool.",
        tools: [
          {
            type: "function",
            name: "weather",
            description: "The weather in a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
      }),
      { ...SHAPES, doc: AGENT },
    )
    await context.step(
      "answer json",
      call(context, "/v1/agent", {
        ...ask,
        input: "Name one colour.",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "colour",
            schema: {
              type: "object",
              properties: { colour: { type: "string" } },
              required: ["colour"],
            },
          },
        },
      }),
      { ...SHAPES, doc: AGENT },
    )
    await context.step(
      "stream an answer",
      call(context, "/v1/agent", { ...ask, input: "Count to three.", stream: true }),
      { ...SHAPES, events: true },
    )
  },
}

const sonar: Scenario = {
  name: "sonar: a chat completion with citations",
  async run(context) {
    await context.step(
      "complete a chat",
      call(context, "/v1/sonar", {
        model: MODEL,
        max_tokens: 20,
        messages: [{ role: "user", content: "What is the capital of Nigeria?" }],
      }),
      { ...SHAPES, doc: { operation: "post /v1/sonar", status: 200 } },
    )
  },
}

const errors: Scenario = {
  name: "errors: no key",
  async run(context) {
    await context.step(
      "no key",
      new Request(`${API}/v1/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, input: "hi" }),
      }),
      { ...SHAPES, doc: ERROR_DOC },
    )
  },
}

export const perplexityFidelity: FidelityProvider = {
  name: "perplexity",
  credentials: [
    { name: KEY, description: "a Perplexity API key; a live run costs a fraction of a cent" },
  ],
  openapi: "https://docs.perplexity.ai/openapi.json",
  scenarios: [agent, sonar, errors],
  emulator: () =>
    emulatorTarget(llm, { key: "pplx-danwoFidelity0000000000000000" }, (emulator) => {
      seedLlm(emulator.store, {
        models: [MODEL],
        prices: { [MODEL]: { input: 1, output: 1 } },
        scripts: [
          {
            match: { tool: "weather" },
            reply: { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          },
          { match: { user: "colour" }, reply: { json: { colour: "blue" } } },
          {
            match: { user: "capital" },
            reply: {
              text: "Abuja is the capital of Nigeria [1].",
              sources: [{ url: "https://en.wikipedia.org/wiki/Abuja", title: "Abuja" }],
            },
          },
        ],
      })
    }),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY]

    return key === undefined ? undefined : liveTarget({ key })
  },
}
