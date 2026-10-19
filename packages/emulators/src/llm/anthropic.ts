/** Anthropic Messages answers, whole or as the stream of message and content block events. */
import type Anthropic from "@anthropic-ai/sdk"

import type { LlmReply, LlmUsage } from "./entities.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText, sse } from "./wire.ts"

type Message = Anthropic.Messages.Message
type Block = Message["content"][number]
type StreamEvent = Anthropic.Messages.RawMessageStreamEvent

/** Why the model stopped, as Messages says it; a content filter reads as a refusal. */
function stopReason(reply: LlmReply): Message["stop_reason"] {
  if (reply.refusal !== undefined || reply.stop === "content_filter") return "refusal"
  if (reply.stop === "length") return "max_tokens"

  return (reply.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn"
}

/**
 * A tool call's input: its arguments as an object. Arguments that are not valid JSON (a malformed
 * call) go out as the raw string, as a broken model output would leave them.
 */
function inputOf(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {}

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function blocks(reply: LlmReply): Block[] {
  const text = reply.refusal ?? messageText(reply)
  const textBlocks: Block[] = text === "" ? [] : [{ type: "text", text, citations: null }]
  const tools = (reply.toolCalls ?? []).map((call): Block => ({
    type: "tool_use",
    id: llmId("toolu_"),
    name: call.name,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a malformed call deliberately sends input that is not an object
    input: inputOf(call.arguments) as Record<string, unknown>,
    caller: { type: "direct" },
  }))

  return [...textBlocks, ...tools]
}

function usage(counts: LlmUsage): Message["usage"] {
  return {
    input_tokens: counts.input,
    output_tokens: counts.output,
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: null,
  }
}

/** A whole message. */
export function anthropicMessage(reply: LlmReply, counts: LlmUsage, model: string): Message {
  return {
    id: llmId("msg_"),
    type: "message",
    role: "assistant",
    model,
    content: blocks(reply),
    container: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: stopReason(reply),
    stop_sequence: null,
    usage: usage(counts),
  } satisfies Message
}

/** One block's events: its start (empty), its text or input in pieces, then its stop. */
function blockEvents(block: Block, index: number, raw: string): StreamEvent[] {
  if (block.type === "tool_use") {
    return [
      { type: "content_block_start", index, content_block: { ...block, input: {} } },
      ...deltas(raw).map((partial): StreamEvent => ({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: partial },
      })),
      { type: "content_block_stop", index },
    ]
  }

  if (block.type !== "text") return []

  return [
    { type: "content_block_start", index, content_block: { ...block, text: "" } },
    ...deltas(block.text).map((text): StreamEvent => ({
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    })),
    { type: "content_block_stop", index },
  ]
}

/** The raw JSON each tool block streams, in block order. */
function rawInputs(reply: LlmReply, message: Message): string[] {
  const calls = reply.toolCalls ?? []
  let next = 0

  return message.content.map((block) =>
    block.type === "tool_use" ? argumentsText(calls[next++]?.arguments) : "",
  )
}

/** A message as its stream of server-sent events. */
export function anthropicStream(reply: LlmReply, whole: Message): string[] {
  return anthropicEvents(reply, whole).map((event) => sse(event, event.type))
}

/** A message as the events it streams in, before they are framed. */
export function anthropicEvents(reply: LlmReply, whole: Message): StreamEvent[] {
  const raws = rawInputs(reply, whole)

  return [
    {
      type: "message_start",
      message: {
        ...whole,
        content: [],
        stop_reason: null,
        usage: { ...whole.usage, output_tokens: 0 },
      },
    },
    ...whole.content.flatMap((block, index) => blockEvents(block, index, raws[index] ?? "")),
    {
      type: "message_delta",
      delta: {
        stop_reason: whole.stop_reason,
        stop_sequence: null,
        container: null,
        stop_details: null,
      },
      usage: {
        output_tokens: whole.usage.output_tokens,
        input_tokens: whole.usage.input_tokens,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        output_tokens_details: null,
        server_tool_use: null,
      },
    },
    { type: "message_stop" },
  ]
}
