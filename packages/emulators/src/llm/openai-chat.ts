/** OpenAI Chat Completions answers, whole or streamed as `chat.completion.chunk`s. */
import type OpenAI from "openai"

import type { LlmReply, LlmUsage } from "./entities.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText, sse, unixSeconds } from "./wire.ts"

type Completion = OpenAI.Chat.Completions.ChatCompletion
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk
type FinishReason = Completion["choices"][number]["finish_reason"]

/** Why the model stopped, as Chat Completions says it. */
function finishReason(reply: LlmReply): FinishReason {
  if (reply.stop === "length") return "length"
  if (reply.stop === "content_filter") return "content_filter"

  return (reply.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop"
}

function toolCalls(reply: LlmReply) {
  return (reply.toolCalls ?? []).map((call) => ({
    id: llmId("call_"),
    type: "function" as const,
    function: { name: call.name, arguments: argumentsText(call.arguments) },
  }))
}

function usage(counts: LlmUsage) {
  return {
    prompt_tokens: counts.input,
    completion_tokens: counts.output,
    total_tokens: counts.input + counts.output,
  }
}

/** The answer metadata every completion and chunk repeats. */
interface Head {
  readonly id: string
  readonly model: string
  readonly created: number
}

export function chatHead(model: string, now: Date): Head {
  return { id: llmId("chatcmpl-"), model, created: unixSeconds(now) }
}

/** A whole completion. */
export function chatCompletion(reply: LlmReply, counts: LlmUsage, head: Head): Completion {
  const calls = toolCalls(reply)
  const text = messageText(reply)

  return {
    ...head,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: reply.refusal === undefined && (text !== "" || calls.length === 0) ? text : null,
          refusal: reply.refusal ?? null,
          ...(calls.length > 0 && { tool_calls: calls }),
        },
        finish_reason: finishReason(reply),
        logprobs: null,
      },
    ],
    usage: usage(counts),
  } satisfies Completion
}

function chunk(head: Head, delta: Chunk["choices"][number]["delta"]): Chunk {
  return {
    ...head,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: null }],
  } satisfies Chunk
}

/** The deltas a reply's tool calls stream in: each call's name, then its arguments. */
function toolDeltas(head: Head, reply: LlmReply): Chunk[] {
  return toolCalls(reply).flatMap((call, index) => [
    chunk(head, {
      tool_calls: [
        {
          index,
          id: call.id,
          type: "function",
          function: { name: call.function.name, arguments: "" },
        },
      ],
    }),
    ...deltas(call.function.arguments).map((piece) =>
      chunk(head, { tool_calls: [{ index, function: { arguments: piece } }] }),
    ),
  ])
}

/** A completion as streamed events, with a final usage chunk when the call asked for one. */
export function chatStream(
  reply: LlmReply,
  counts: LlmUsage,
  head: Head,
  includeUsage: boolean,
): string[] {
  const content =
    reply.refusal === undefined
      ? deltas(messageText(reply)).map((piece) => chunk(head, { content: piece }))
      : [chunk(head, { refusal: reply.refusal })]
  const last: Chunk = {
    ...head,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason(reply) }],
  }
  const tail: Chunk[] = includeUsage
    ? [{ ...head, object: "chat.completion.chunk", choices: [], usage: usage(counts) }]
    : []
  const chunks = [
    chunk(head, { role: "assistant", content: "" }),
    ...content,
    ...toolDeltas(head, reply),
    last,
    ...tail,
  ]

  return [...chunks.map((item) => sse(item)), sse("[DONE]")]
}
