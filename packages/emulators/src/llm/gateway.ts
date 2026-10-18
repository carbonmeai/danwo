/**
 * Vercel AI Gateway answers, in the language model protocol the AI SDK's gateway provider speaks:
 * a whole generate result, or its stream parts as server-sent events. The gateway reports each
 * call's cost in its provider metadata, so an app's cost tracking reads the scripted price.
 */
import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider"

import type { LlmPrice, LlmReply, LlmUsage } from "./entities.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText, sse } from "./wire.ts"

type Content = LanguageModelV4GenerateResult["content"][number]

/** The unified finish reason; the gateway does not pass the upstream's own reason on. */
function finishReason(reply: LlmReply): LanguageModelV4FinishReason {
  if (reply.refusal !== undefined || reply.stop === "content_filter")
    return { unified: "content-filter", raw: undefined }
  if (reply.stop === "length") return { unified: "length", raw: undefined }

  return { unified: (reply.toolCalls?.length ?? 0) > 0 ? "tool-calls" : "stop", raw: undefined }
}

/** The provider a gateway model id routes to: `openai` for `openai/gpt-4.1-nano`. */
function upstreamOf(model: string): string {
  return model.split("/")[0] || "openai"
}

/** Token counts, with the upstream's own usage object passed through as `raw`. */
function usage(counts: LlmUsage): LanguageModelV4Usage {
  return {
    inputTokens: { total: counts.input, noCache: counts.input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: counts.output, text: counts.output, reasoning: 0 },
    raw: {
      input_tokens: counts.input,
      output_tokens: counts.output,
      total_tokens: counts.input + counts.output,
    },
  }
}

/** Dollars the way the gateway writes them: a decimal string. */
function dollars(amount: number): string {
  return amount.toFixed(8)
}

/** How the gateway routed a call: the model asked for and the provider that answered it. */
function routing(model: string) {
  const upstream = upstreamOf(model)

  return { originalModelId: model, resolvedProvider: upstream, finalProvider: upstream }
}

/**
 * The gateway's metadata for a call: its routing, a generation id, and its cost split into
 * inference (input and output) and the gateway's surcharge, which the emulator never adds. A
 * model with no price costs nothing.
 */
function metadata(counts: LlmUsage, model: string, price: LlmPrice | undefined) {
  const input = (counts.input * (price?.input ?? 0)) / 1_000_000
  const output = (counts.output * (price?.output ?? 0)) / 1_000_000
  const cost = dollars(input + output)

  return {
    [upstreamOf(model)]: {},
    gateway: {
      routing: routing(model),
      cost,
      marketCost: cost,
      surchargeCost: dollars(0),
      gatewayCost: cost,
      inferenceCost: cost,
      inputInferenceCost: dollars(input),
      outputInferenceCost: dollars(output),
      generationId: llmId("gen_"),
    },
  }
}

/** The gateway's metadata for an embedding call, which it does not split by input and output. */
export function embeddingMetadata(tokens: number, model: string, price: LlmPrice | undefined) {
  const cost = dollars((tokens * (price?.input ?? 0)) / 1_000_000)

  return {
    gateway: {
      routing: routing(model),
      cost,
      marketCost: cost,
      surchargeCost: dollars(0),
      gatewayCost: cost,
      generationId: llmId("gen_"),
    },
  }
}

/** The reply as content items, each carrying the upstream provider's (empty) metadata for it. */
function content(reply: LlmReply, upstream: string): Content[] {
  const text = reply.refusal ?? messageText(reply)
  const providerMetadata = { [upstream]: {} }
  const calls = (reply.toolCalls ?? []).map((call): Content => ({
    type: "tool-call",
    toolCallId: llmId("call_"),
    toolName: call.name,
    input: argumentsText(call.arguments),
    providerMetadata,
  }))

  return [...(text === "" ? [] : [{ type: "text" as const, text, providerMetadata }]), ...calls]
}

/**
 * A whole generate result. The gateway sends no `response` block: the AI SDK fills the response's
 * id and model in from the call itself.
 */
export function gatewayResult(
  reply: LlmReply,
  counts: LlmUsage,
  model: string,
  price: LlmPrice | undefined,
): LanguageModelV4GenerateResult {
  return {
    content: content(reply, upstreamOf(model)),
    finishReason: finishReason(reply),
    usage: usage(counts),
    providerMetadata: metadata(counts, model, price),
    warnings: [],
  } satisfies LanguageModelV4GenerateResult
}

/**
 * One content item's stream parts: text in pieces, its start and end carrying the item's provider
 * metadata, or a tool call's input in pieces.
 */
function contentParts(item: Content): LanguageModelV4StreamPart[] {
  if (item.type === "text") {
    const id = llmId("txt_")
    const providerMetadata = item.providerMetadata ?? {}

    return [
      { type: "text-start", id, providerMetadata },
      ...deltas(item.text).map((delta): LanguageModelV4StreamPart => ({
        type: "text-delta",
        id,
        delta,
      })),
      { type: "text-end", id, providerMetadata },
    ]
  }

  if (item.type !== "tool-call") return []

  return [
    { type: "tool-input-start", id: item.toolCallId, toolName: item.toolName },
    ...deltas(item.input).map((delta): LanguageModelV4StreamPart => ({
      type: "tool-input-delta",
      id: item.toolCallId,
      delta,
    })),
    { type: "tool-input-end", id: item.toolCallId },
    item,
  ]
}

/** A generate result as its stream of parts, for a call to `model` answered at `now`. */
export function gatewayStream(
  whole: LanguageModelV4GenerateResult,
  model: string,
  now: Date,
): string[] {
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: llmId("gen_"), timestamp: now, modelId: model },
    ...whole.content.flatMap(contentParts),
    {
      type: "finish",
      usage: whole.usage,
      finishReason: whole.finishReason,
      ...(whole.providerMetadata !== undefined && { providerMetadata: whole.providerMetadata }),
    },
  ]

  return parts.map((part) => sse(part))
}
