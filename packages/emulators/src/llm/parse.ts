/**
 * Reads a real provider's whole answer back into a reply, so a recording can script it: the text,
 * tool calls, a refusal, and whether the answer was cut off.
 */
import { asRecord } from "../json.ts"
import type { LlmReply, LlmSource, LlmToolCall } from "./entities.ts"

/** Each API a call can come through, by its route; all but Bedrock's can be recorded. */
export type LlmApi =
  | "chat"
  | "responses"
  | "messages"
  | "language-model"
  | "gemini"
  | "agent"
  | "converse"
  | "converse-stream"
  | "invoke"

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

/** Each provider's word for stopping at the token limit or at a content filter. */
const STOPS: ReadonlyMap<unknown, LlmReply["stop"]> = new Map<unknown, LlmReply["stop"]>([
  ["length", "length"],
  ["max_tokens", "length"],
  ["max_output_tokens", "length"],
  ["MAX_TOKENS", "length"],
  ["content_filter", "content_filter"],
  ["content-filter", "content_filter"],
  ["content_filtered", "content_filter"],
  ["SAFETY", "content_filter"],
])

function stopOf(reason: unknown): LlmReply["stop"] {
  return STOPS.get(reason)
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

/** A Gemini answer: its first candidate's text and function calls. */
function fromGemini(body: Record<string, unknown>): LlmReply {
  const candidate = asRecord(list(body.candidates)[0])
  const parts = list(asRecord(candidate?.content)?.parts).map(asRecord)

  return reply({
    text: parts.map((part) => str(part?.text) ?? ""),
    calls: parts.flatMap((part) => {
      const call = asRecord(part?.functionCall)

      return call === undefined ? [] : [{ name: str(call.name) ?? "", arguments: call.args ?? {} }]
    }),
    stop: stopOf(candidate?.finishReason),
  })
}

/** A Converse answer: its message's text and tool uses. */
function fromConverse(body: Record<string, unknown>): LlmReply {
  const blocks = list(asRecord(asRecord(body.output)?.message)?.content).map(asRecord)

  return reply({
    text: blocks.map((block) => str(block?.text) ?? ""),
    calls: blocks.flatMap((block) => {
      const use = asRecord(block?.toolUse)

      return use === undefined ? [] : [{ name: str(use.name) ?? "", arguments: use.input ?? {} }]
    }),
    stop: stopOf(body.stopReason),
  })
}

/** Perplexity's Agent API answers like the Responses API, with its citations as sources. */
function fromAgent(body: Record<string, unknown>): LlmReply {
  const found = fromResponses(body)
  const results = list(body.output)
    .map(asRecord)
    .filter((item) => item?.type === "search_results")
    .flatMap((item) => list(item?.results).map(asRecord))
  const sources = results.map((result): LlmSource => {
    const title = str(result?.title)

    return { url: str(result?.url) ?? "", ...(title !== undefined && { title }) }
  })

  return sources.length === 0 ? found : { ...found, sources }
}

const READERS: Record<LlmApi, (body: Record<string, unknown>) => LlmReply> = {
  chat: fromChat,
  responses: fromResponses,
  messages: fromMessages,
  "language-model": fromGateway,
  gemini: fromGemini,
  agent: fromAgent,
  converse: fromConverse,
  "converse-stream": fromConverse,
  invoke: fromMessages,
}

/** A real answer from `api` as a reply. */
export function replyFromAnswer(api: LlmApi, body: unknown): LlmReply {
  return READERS[api](asRecord(body) ?? {})
}
