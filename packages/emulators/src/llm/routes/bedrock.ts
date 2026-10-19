/**
 * Bedrock's runtime routes on `bedrock-runtime.<region>.amazonaws.com`: `/model/{id}/converse`,
 * `/converse-stream`, `/invoke` and `/invoke-with-response-stream`, the model id URL-encoded as the
 * AWS SDKs send it (inference profiles and ARNs included).
 */
import type { EmulatorContext } from "../../define.ts"
import { HttpError } from "../../errors.ts"
import type { Context } from "../../http.ts"
import { answer } from "../answer.ts"
import {
  converseFrames,
  converseRequest,
  converseResponse,
  familyOf,
  invokeFrames,
  invokeRequest,
  invokeResponse,
} from "../bedrock.ts"
import { bodyOf, onlyFor } from "../context.ts"
import { embed, inputsOf } from "../embeddings.ts"
import type { LlmUsage } from "../entities.ts"
import { eventStreamResponse } from "../eventstream.ts"
import { str } from "../requests.ts"
import { tokensIn } from "../usage.ts"
import { cutJson } from "../wire.ts"

const OPERATIONS = ["converse", "converse-stream", "invoke", "invoke-with-response-stream"] as const

type Operation = (typeof OPERATIONS)[number]

/** The model and operation a path names: `/model/<encoded id>/<operation>`. */
function addressOf(c: Context): { model: string; operation: Operation } {
  const segments = new URL(c.req.url).pathname.split("/").slice(2)
  const operation = OPERATIONS.find((name) => name === segments.at(-1))

  if (operation === undefined || segments.length < 2)
    throw new HttpError(404, "Unable to determine service/operation name to be authorized")

  return { model: decodeURIComponent(segments.slice(0, -1).join("/")), operation }
}

/** The token counts InvokeModel reports in its headers as well as its body. */
function usageHeaders(counts: LlmUsage): Record<string, string> {
  return {
    "x-amzn-bedrock-input-token-count": String(counts.input),
    "x-amzn-bedrock-output-token-count": String(counts.output),
    "x-amzn-bedrock-invocation-latency": "120",
  }
}

/** Titan's and Cohere's embedding answers. */
function embeddingAnswer(c: Context, body: Record<string, unknown>, model: string): Response {
  if (familyOf(model) === "titan-embed") {
    const text = str(body.inputText)
    const size = typeof body.dimensions === "number" ? body.dimensions : 1024

    return c.json({ embedding: embed(text, size), inputTextTokenCount: tokensIn(text) })
  }

  const texts = inputsOf(body.texts)

  return c.json({
    id: crypto.randomUUID(),
    response_type: "embeddings_floats",
    texts,
    embeddings: texts.map((text) => embed(text, 1024)),
  })
}

async function converse(emulator: EmulatorContext, c: Context, model: string, stream: boolean) {
  const request = converseRequest(await bodyOf(c), model, stream)
  const answered = await answer(emulator, c, stream ? "converse-stream" : "converse", request)
  const whole = converseResponse(answered.reply, answered.usage, request)
  const cut = answered.behaviour === "stream-cut"

  if (stream) return eventStreamResponse(converseFrames(whole), cut)

  return cut ? cutJson(whole) : c.json(whole)
}

async function invoke(emulator: EmulatorContext, c: Context, model: string, stream: boolean) {
  const body = await bodyOf(c)
  const family = familyOf(model)

  if (family === "titan-embed" || family === "cohere-embed") return embeddingAnswer(c, body, model)

  const request = invokeRequest(body, model, stream)
  const answered = await answer(emulator, c, "invoke", request)
  const cut = answered.behaviour === "stream-cut"

  if (stream) return eventStreamResponse(invokeFrames(answered.reply, answered.usage, request), cut)

  const whole = invokeResponse(answered.reply, answered.usage, request)

  return cut ? cutJson(whole) : c.json(whole, 200, usageHeaders(answered.usage))
}

export function bedrockRoutes(emulator: EmulatorContext): void {
  emulator.app.post("/model/:model/:operation", (c) => {
    onlyFor(c, "bedrock")

    const { model, operation } = addressOf(c)

    if (operation === "converse" || operation === "converse-stream")
      return converse(emulator, c, model, operation === "converse-stream")

    return invoke(emulator, c, model, operation === "invoke-with-response-stream")
  })
}
