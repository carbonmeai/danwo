/**
 * Amazon Bedrock's fidelity suite (`bedrock-runtime.<region>.amazonaws.com`): Converse with text
 * and a tool call, InvokeModel in Nova's body, and the answer to an unsigned call. Live runs use a
 * Bedrock API key (a bearer token, so the harness needs no SigV4 signer) and Nova Micro with a few
 * output tokens. AWS publishes no OpenAPI description for Bedrock, so the goldens without a key are
 * written from the Converse and InvokeModel API reference. The streaming calls answer in AWS's
 * binary event stream, which the harness does not read; their framing is covered by tests that
 * drive the AWS SDK.
 */
import { llm, seedLlm } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, StepDoc, StepOptions } from "../scenario.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const KEY = "DANWO_FIDELITY_BEDROCK_API_KEY"
const REGION = "DANWO_FIDELITY_BEDROCK_REGION"
const MODEL = "amazon.nova-micro-v1:0"

/** Values that are part of the protocol: stop reasons and roles. */
const LITERALS = ["stopReason", "output.message.role"]

/** Objects whose keys vary with the call: a tool's input. */
const MAPS = ["output.message.content[].toolUse.input"]

const SHAPES: StepOptions = { literals: LITERALS, maps: MAPS }

const NUMBER = { type: "number" }
const STRING = { type: "string" }

/** A Converse answer, as the API reference gives it. */
const CONVERSE_SCHEMA = {
  type: "object",
  required: ["output", "stopReason", "usage", "metrics"],
  properties: {
    output: {
      type: "object",
      required: ["message"],
      properties: {
        message: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: STRING,
            content: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: STRING,
                  toolUse: {
                    type: "object",
                    required: ["toolUseId", "name", "input"],
                    properties: { toolUseId: STRING, name: STRING, input: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    stopReason: STRING,
    usage: {
      type: "object",
      required: ["inputTokens", "outputTokens", "totalTokens"],
      properties: { inputTokens: NUMBER, outputTokens: NUMBER, totalTokens: NUMBER },
      "x-danwo-open": true,
    },
    metrics: { type: "object", required: ["latencyMs"], properties: { latencyMs: NUMBER } },
  },
}

const { metrics: _metrics, ...NOVA_PROPERTIES } = CONVERSE_SCHEMA.properties

/** Nova's InvokeModel answer: Converse's shape without its metrics. */
const NOVA_SCHEMA = {
  ...CONVERSE_SCHEMA,
  required: ["output", "stopReason", "usage"],
  properties: NOVA_PROPERTIES,
}

const ERROR_DOC: StepDoc = {
  status: 403,
  schema: { type: "object", required: ["message"], properties: { message: STRING } },
  literals: { message: "Missing Authentication Token" },
}

function endpoint(context: ScenarioContext, operation: string): string {
  const region = context.target.credentials["region"] ?? "us-east-1"

  return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(MODEL)}/${operation}`
}

function call(context: ScenarioContext, operation: string, body: unknown): Request {
  return new Request(endpoint(context, operation), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential(context.target, "key")}`,
    },
    body: JSON.stringify(body),
  })
}

const ask = (text: string) => ({
  messages: [{ role: "user", content: [{ text }] }],
  inferenceConfig: { maxTokens: 20 },
})

const converse: Scenario = {
  name: "converse: text and a tool call",
  async run(context) {
    await context.step("converse", call(context, "converse", ask("Reply with one word: hello.")), {
      ...SHAPES,
      doc: { schema: CONVERSE_SCHEMA, status: 200 },
    })
    await context.step(
      "call a tool",
      call(context, "converse", {
        ...ask("What is the weather in Lagos? Use the tool."),
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: "weather",
                description: "The weather in a city",
                inputSchema: {
                  json: {
                    type: "object",
                    properties: { city: { type: "string" } },
                    required: ["city"],
                  },
                },
              },
            },
          ],
          toolChoice: { any: {} },
        },
      }),
      { ...SHAPES, doc: { schema: CONVERSE_SCHEMA, status: 200 } },
    )
  },
}

const invoke: Scenario = {
  name: "invoke: Nova's body",
  async run(context) {
    await context.step("invoke", call(context, "invoke", ask("Reply with one word: hello.")), {
      ...SHAPES,
      doc: { schema: NOVA_SCHEMA, status: 200 },
    })
  },
}

const errors: Scenario = {
  name: "errors: unsigned call",
  async run(context) {
    await context.step(
      "no signature",
      new Request(endpoint(context, "converse"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ask("hi")),
      }),
      { ...SHAPES, literals: [...LITERALS, "message"], doc: ERROR_DOC },
    )
  },
}

export const bedrockFidelity: FidelityProvider = {
  name: "bedrock",
  leaves: "nothing: model calls store nothing",
  credentials: [
    {
      name: KEY,
      description:
        "a Bedrock API key with Nova Micro enabled in the region; a live run costs a fraction of a cent",
    },
    { name: REGION, description: "the region to call (default us-east-1)", optional: true },
  ],
  scenarios: [converse, invoke, errors],
  emulator: () =>
    emulatorTarget(llm, { key: "REDACTED-TEST-VALUE" }, (emulator) => {
      seedLlm(emulator.store, {
        models: [MODEL],
        scripts: [
          {
            match: { tool: "weather" },
            reply: { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
          },
        ],
      })
    }),
  live(env) {
    const found = requiredCredentials(this, env)
    const key = found?.[KEY]

    if (key === undefined) return undefined

    return liveTarget({ key, ...(found?.[REGION] !== undefined && { region: found[REGION] }) })
  },
}
