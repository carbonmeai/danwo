/** OpenAI Responses API answers, whole or as the typed stream of response events. */
import type OpenAI from "openai"

import type { LlmReply, LlmUsage } from "./entities.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText, sse, unixSeconds } from "./wire.ts"

type ApiResponse = OpenAI.Responses.Response
type OutputItem = OpenAI.Responses.ResponseOutputItem
type OutputMessage = OpenAI.Responses.ResponseOutputMessage
type FunctionCall = OpenAI.Responses.ResponseFunctionToolCall
type StreamEvent = OpenAI.Responses.ResponseStreamEvent

function messageItem(reply: LlmReply): OutputMessage {
  const content: OutputMessage["content"] =
    reply.refusal === undefined
      ? [{ type: "output_text", text: messageText(reply), annotations: [], logprobs: [] }]
      : [{ type: "refusal", refusal: reply.refusal }]

  return { type: "message", id: llmId("msg_"), role: "assistant", status: "completed", content }
}

function callItems(reply: LlmReply): FunctionCall[] {
  return (reply.toolCalls ?? []).map((call) => ({
    type: "function_call",
    id: llmId("fc_"),
    call_id: llmId("call_"),
    name: call.name,
    arguments: argumentsText(call.arguments),
    status: "completed",
  }))
}

/** The items a reply's output holds: a message unless it only calls tools, then its tool calls. */
function outputOf(reply: LlmReply): OutputItem[] {
  const calls = callItems(reply)
  const hasMessage = calls.length === 0 || messageText(reply) !== "" || reply.refusal !== undefined

  return [...(hasMessage ? [messageItem(reply)] : []), ...calls]
}

function incompleteReason(reply: LlmReply): ApiResponse["incomplete_details"] {
  if (reply.stop === "length") return { reason: "max_output_tokens" }
  if (reply.stop === "content_filter") return { reason: "content_filter" }

  return null
}

/** A whole response. */
export function responseObject(
  reply: LlmReply,
  counts: LlmUsage,
  model: string,
  now: Date,
): ApiResponse {
  const incomplete = incompleteReason(reply)

  return {
    id: llmId("resp_"),
    object: "response",
    access_programs: null,
    created_at: unixSeconds(now),
    status: incomplete === null ? "completed" : "incomplete",
    model,
    output: outputOf(reply),
    output_text: reply.refusal === undefined ? messageText(reply) : "",
    error: null,
    incomplete_details: incomplete,
    instructions: null,
    metadata: null,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: counts.input,
      output_tokens: counts.output,
      total_tokens: counts.input + counts.output,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  } satisfies ApiResponse
}

/** Events that build one output item: added, its content or arguments in pieces, then done. */
function itemEvents(item: OutputItem, index: number): Array<Omit<StreamEvent, "sequence_number">> {
  const added = { type: "response.output_item.added", item, output_index: index } as const
  const done = { type: "response.output_item.done", item, output_index: index } as const

  if (item.type === "function_call") {
    const pieces = deltas(item.arguments).map((delta) => ({
      type: "response.function_call_arguments.delta" as const,
      item_id: item.id ?? "",
      output_index: index,
      delta,
    }))
    const finished = {
      type: "response.function_call_arguments.done" as const,
      item_id: item.id ?? "",
      output_index: index,
      name: item.name,
      arguments: item.arguments,
    }

    return [added, ...pieces, finished, done]
  }

  return item.type === "message" ? [added, ...messageEvents(item, index), done] : [added, done]
}

/** A message's text in pieces, between its content part's start and end. */
function messageEvents(item: OutputMessage, index: number) {
  const part = item.content[0]
  const at = { item_id: item.id, output_index: index, content_index: 0 }

  if (part?.type !== "output_text") return []

  return [
    { type: "response.content_part.added" as const, ...at, part },
    ...deltas(part.text).map((delta) => ({
      type: "response.output_text.delta" as const,
      ...at,
      delta,
      logprobs: [],
    })),
    { type: "response.output_text.done" as const, ...at, text: part.text, logprobs: [] },
    { type: "response.content_part.done" as const, ...at, part },
  ]
}

/** A response as its stream of events, each numbered in order. */
export function responseStream(whole: ApiResponse): string[] {
  const finished =
    whole.status === "incomplete" ? "response.incomplete" : ("response.completed" as const)
  const events = [
    { type: "response.created", response: { ...whole, status: "in_progress", output: [] } },
    ...whole.output.flatMap((item, index) => itemEvents(item, index)),
    { type: finished, response: whole },
  ]

  return events.map((event, sequence) => sse({ ...event, sequence_number: sequence }, event.type))
}
