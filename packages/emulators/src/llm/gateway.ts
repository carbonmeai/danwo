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

import type { LlmReply, LlmUsage } from "./entities.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText, sse } from "./wire.ts"

type Content = LanguageModelV4GenerateResult["content"][number]

function finishReason(reply: LlmReply): LanguageModelV4FinishReason {
  if (reply.refusal !== undefined || reply.stop === "content_filter")
    return { unified: "content-filter", raw: "content_filter" }
  if (reply.stop === "length") return { unified: "length", raw: "length" }

  return (reply.toolCalls?.length ?? 0) > 0
    ? { unified: "tool-calls", raw: "tool_calls" }
    : { unified: "stop", raw: "stop" }
}

function usage(counts: LlmUsage): LanguageModelV4Usage {
  return {
    inputTokens: { total: counts.input, noCache: counts.input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: counts.output, text: counts.output, reasoning: 0 },
  }
}

/** The gateway's cost metadata, when the model has a price. */
function metadata(cost: number | null) {
  return cost === null
    ? {}
    : { providerMetadata: { gateway: { cost: cost.toFixed(8), marketCost: cost.toFixed(8) } } }
}

function content(reply: LlmReply): Content[] {
  const text = reply.refusal ?? messageText(reply)
  const calls = (reply.toolCalls ?? []).map((call): Content => ({
    type: "tool-call",
    toolCallId: llmId("call_"),
    toolName: call.name,
    input: argumentsText(call.arguments),
  }))

  return [...(text === "" ? [] : [{ type: "text" as const, text }]), ...calls]
}

/** A whole generate result. */
export function gatewayResult(
  reply: LlmReply,
  counts: LlmUsage,
  model: string,
  cost: number | null,
): LanguageModelV4GenerateResult {
  return {
    content: content(reply),
    finishReason: finishReason(reply),
    usage: usage(counts),
    warnings: [],
    response: { id: llmId("gen_"), modelId: model },
    ...metadata(cost),
  } satisfies LanguageModelV4GenerateResult
}

/** One content item's stream parts: text in pieces, or a tool call's input in pieces. */
function contentParts(item: Content): LanguageModelV4StreamPart[] {
  if (item.type === "text") {
    const id = llmId("txt_")

    return [
      { type: "text-start", id },
      ...deltas(item.text).map((delta): LanguageModelV4StreamPart => ({
        type: "text-delta",
        id,
        delta,
      })),
      { type: "text-end", id },
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

/** A generate result as its stream of parts. */
export function gatewayStream(whole: LanguageModelV4GenerateResult): string[] {
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", ...whole.response },
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
