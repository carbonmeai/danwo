/**
 * Token counts and cost. Counts are an estimate (about four characters a token), the same for the
 * same text every time, so an app's usage and cost tracking can be tested exactly.
 */
import type { LlmPrice, LlmReply, LlmRequest, LlmUsage } from "./entities.ts"

/** The estimated tokens in `text`. */
export function tokensIn(text: string): number {
  return text === "" ? 0 : Math.ceil(text.length / 4)
}

/** The text a reply's tokens are counted from. */
function replyText(reply: LlmReply): string {
  const calls = (reply.toolCalls ?? []).map((call) => call.name + argumentsText(call.arguments))
  const json = reply.json === undefined ? "" : JSON.stringify(reply.json)

  return [reply.text ?? "", reply.refusal ?? "", json, ...calls].join("")
}

/** A tool call's arguments as the wire carries them: JSON, or a string as it is. */
export function argumentsText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? {})
}

/** The tokens a call's prompt holds: its system prompt, messages and tool names. */
export function promptTokens(request: LlmRequest): number {
  const asked = [request.system, ...request.messages.map((m) => m.text), ...request.tools]

  return tokensIn(asked.filter(Boolean).join("\n"))
}

/** The tokens a call read and wrote. */
export function usageOf(request: LlmRequest, reply: LlmReply): LlmUsage {
  return { input: promptTokens(request), output: tokensIn(replyText(reply)) }
}

/** What a call cost in dollars, when its model has a price. */
export function costOf(usage: LlmUsage, price: LlmPrice | undefined): number | null {
  if (price === undefined) return null

  return (usage.input * price.input + usage.output * price.output) / 1_000_000
}
