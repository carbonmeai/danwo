/**
 * Reads a real provider's whole answer back into a reply, so a recording can script it: the text,
 * tool calls, a refusal, and whether the answer was cut off.
 */
import { asRecord } from "../json.ts"
import type { LlmReply, LlmToolCall } from "./entities.ts"

/** Each API a recording can read, by the route the call came through. */
export type LlmApi = "chat" | "responses" | "messages" | "language-model"

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Arguments as an object when they are JSON, as the string otherwise. */
function argumentsOf(value: unknown): unknown {
  const text = str(value)

  if (text === undefined) return value

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** A reply from its parts, leaving out the empty ones. */
function reply(parts: {
  text: string[]
  calls: LlmToolCall[]
  refusal?: string | undefined
  stop?: LlmReply["stop"]
}): LlmReply {
  const text = parts.text.join("")

  return {
    ...(text !== "" && { text }),
    ...(parts.calls.length > 0 && { toolCalls: parts.calls }),
    ...(parts.refusal !== undefined && { refusal: parts.refusal }),
    ...(parts.stop !== undefined && { stop: parts.stop }),
  }
}

function stopOf(reason: unknown): LlmReply["stop"] {
  if (reason === "length" || reason === "max_tokens" || reason === "max_output_tokens")
    return "length"

  return reason === "content_filter" || reason === "content-filter" ? "content_filter" : undefined
}

function fromChat(body: Record<string, unknown>): LlmReply {
  const choice = asRecord(list(body.choices)[0])
  const message = asRecord(choice?.message)
  const calls = list(message?.tool_calls).map((entry) => {
    const fn = asRecord(asRecord(entry)?.function)

    return { name: str(fn?.name) ?? "", arguments: argumentsOf(fn?.arguments) }
  })

  return reply({
    text: [str(message?.content) ?? ""],
    calls,
    refusal: str(message?.refusal),
    stop: stopOf(choice?.finish_reason),
  })
}

function fromResponses(body: Record<string, unknown>): LlmReply {
  const items = list(body.output).map(asRecord)
  const parts = items.flatMap((item) => list(item?.content).map(asRecord))
  const calls = items
    .filter((item) => item?.type === "function_call")
    .map((item) => ({ name: str(item?.name) ?? "", arguments: argumentsOf(item?.arguments) }))

  return reply({
    text: parts.map((part) => (part?.type === "output_text" ? (str(part.text) ?? "") : "")),
    calls,
    refusal: str(parts.find((part) => part?.type === "refusal")?.refusal),
    stop: stopOf(asRecord(body.incomplete_details)?.reason),
  })
}

function fromMessages(body: Record<string, unknown>): LlmReply {
  const blocks = list(body.content).map(asRecord)
  const text = blocks.map((block) => (block?.type === "text" ? (str(block.text) ?? "") : ""))
  const calls = blocks
    .filter((block) => block?.type === "tool_use")
    .map((block) => ({ name: str(block?.name) ?? "", arguments: block?.input ?? {} }))
  const refused = body.stop_reason === "refusal"

  return reply({
    text: refused ? [] : text,
    calls,
    refusal: refused ? text.join("") : undefined,
    stop: stopOf(body.stop_reason),
  })
}

function fromGateway(body: Record<string, unknown>): LlmReply {
  const items = list(body.content).map(asRecord)

  return reply({
    text: items.map((item) => (item?.type === "text" ? (str(item.text) ?? "") : "")),
    calls: items
      .filter((item) => item?.type === "tool-call")
      .map((item) => ({ name: str(item?.toolName) ?? "", arguments: argumentsOf(item?.input) })),
    stop: stopOf(asRecord(body.finishReason)?.unified),
  })
}

const READERS: Record<LlmApi, (body: Record<string, unknown>) => LlmReply> = {
  chat: fromChat,
  responses: fromResponses,
  messages: fromMessages,
  "language-model": fromGateway,
}

/** A real answer from `api` as a reply. */
export function replyFromAnswer(api: LlmApi, body: unknown): LlmReply {
  return READERS[api](asRecord(body) ?? {})
}
