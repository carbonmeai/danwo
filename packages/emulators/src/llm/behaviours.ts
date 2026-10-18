/**
 * Ways a model call goes wrong that only the emulator can shape, acted out when the proxy's fault
 * asks for one: a refusal, an empty answer, an answer cut off by the token limit or a content
 * filter, a tool call whose arguments are not valid JSON, and a stream that stops half-way.
 */
import type { LlmReply, LlmRequest } from "./entities.ts"

/** The behaviours an `emulate` fault can name on a model API route. */
export const LLM_BEHAVIOURS = [
  "refusal",
  "empty-completion",
  "truncated",
  "content-filter",
  "malformed-tool-call",
  "stream-cut",
] as const

export type LlmBehaviour = (typeof LLM_BEHAVIOURS)[number]

/** The behaviour a request header names, when it is one of ours. */
export function behaviourOf(header: string | undefined): LlmBehaviour | undefined {
  return LLM_BEHAVIOURS.find((behaviour) => behaviour === header)
}

/** The first half of `text`, at least one character when there is any. */
function half(text: string): string {
  return text.slice(0, Math.max(1, Math.floor(text.length / 2)))
}

/** A tool call whose arguments break off, as a model's sometimes do. */
function malformed(reply: LlmReply, request: LlmRequest): LlmReply {
  const name = reply.toolCalls?.[0]?.name ?? request.tools[0]

  if (name === undefined) return reply

  return { toolCalls: [{ name, arguments: '{"' }] }
}

/** `reply` as `behaviour` turns it. A stream cut short is handled where the stream is written. */
export function actOut(
  reply: LlmReply,
  behaviour: LlmBehaviour | undefined,
  request: LlmRequest,
): LlmReply {
  switch (behaviour) {
    case "refusal":
      return { refusal: "I can't help with that request." }
    case "empty-completion":
      return { text: "" }
    case "truncated":
      return { text: half(reply.text ?? JSON.stringify(reply.json ?? "")), stop: "length" }
    case "content-filter":
      return { text: "", stop: "content_filter" }
    case "malformed-tool-call":
      return malformed(reply, request)
    default:
      return reply
  }
}
