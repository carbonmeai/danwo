/**
 * What the model API emulator scripts, answers and records, the same whichever provider's API a
 * call came through.
 */
import type { Entity } from "../store.ts"

/** The APIs the emulator answers. */
export type LlmProvider = "openai" | "anthropic" | "gateway" | "google" | "perplexity" | "bedrock"

/** One tool call a scripted reply makes; `arguments` is sent as JSON, or as is when a string. */
export interface LlmToolCall {
  readonly name: string
  readonly arguments: unknown
}

/** A web page an answer cites, as search-backed models (Perplexity) list their sources. */
export interface LlmSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** When the page was published, as `YYYY-MM-DD`. */
  readonly date?: string
}

/**
 * What the model answers: text, tool calls, a structured object (for a `response_format` or JSON
 * response), or a refusal; `stop` ends it early, as running out of tokens or a content filter does.
 * `sources` are the pages a search-backed answer cites; providers without citations leave them out.
 */
export interface LlmReply {
  readonly text?: string
  readonly toolCalls?: readonly LlmToolCall[]
  readonly json?: unknown
  readonly refusal?: string
  readonly stop?: "length" | "content_filter"
  readonly sources?: readonly LlmSource[]
}

/** A pattern as stored: a regular expression's source and flags. */
export interface StoredPattern {
  readonly source: string
  readonly flags: string
}

/** When a script answers; every given field must match. */
export interface StoredMatch {
  readonly provider?: LlmProvider
  readonly model?: StoredPattern
  /** The last user message. */
  readonly user?: StoredPattern
  readonly system?: StoredPattern
  /** A tool the call offers, by name. */
  readonly tool?: string
  /** Whether the call's last message hands back a tool's result (the turn after a tool call). */
  readonly toolResult?: boolean
  /** The exact request, as a recording identifies it. */
  readonly fingerprint?: string
}

/** A script as stored: its replies are given out in order, the last one repeating. */
export interface ScriptRow extends Entity {
  readonly name: string
  readonly match: StoredMatch
  readonly replies: readonly LlmReply[]
  readonly served: number
  readonly recorded: boolean
}

/** One message of a call, reduced to its role and text. */
export interface LlmMessage {
  readonly role: string
  readonly text: string
}

/** A call as the emulator understood it, whichever API it came through. */
export interface LlmRequest {
  readonly provider: LlmProvider
  readonly model: string
  readonly system: string
  readonly messages: readonly LlmMessage[]
  readonly tools: readonly string[]
  /** The JSON schema a structured answer must follow, when the call asks for one. */
  readonly schema?: unknown
  readonly stream: boolean
}

/** Token counts of one call. */
export interface LlmUsage {
  readonly input: number
  readonly output: number
}

/** A call the emulator answered, as tests read it back. */
export interface CallRow extends Entity {
  readonly provider: LlmProvider
  readonly api: string
  readonly model: string
  readonly system: string
  readonly messages: readonly LlmMessage[]
  readonly tools: readonly string[]
  readonly stream: boolean
  readonly reply: LlmReply
  /** The script that answered it: a name, `recorded:<n>`, or null when nothing was scripted. */
  readonly script: string | null
  /** The fault the proxy asked the emulator to act out, if any. */
  readonly fault: string | null
  readonly usage: LlmUsage
  /** In dollars, when the model has a price. */
  readonly cost: number | null
}

/** A model's price in dollars per million tokens. */
export interface LlmPrice {
  readonly input: number
  readonly output: number
}
