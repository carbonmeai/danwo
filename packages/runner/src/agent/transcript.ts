/**
 * The conversation of one agent step. It only grows, so every turn's prompt starts with the
 * previous turn's prompt and providers can serve that prefix from their prompt cache. Page views
 * are the bulk of it: when the conversation passes its size budget, every view but the latest is
 * replaced by a short stub in one go, and it grows again from there. Between compactions nothing
 * already sent changes.
 *
 * The newest message is marked as a cache breakpoint for providers that take one (Anthropic's
 * `cacheControl`, passed through the AI Gateway as provider options); others cache prefixes on
 * their own.
 */
import type { ModelMessage } from "ai"

/** Separates what a message says from the page view it carries. */
export const VIEW_MARK = "\n\nThe page now:\n"

/** What an older view becomes once the conversation is compacted. */
const STUB = "\n\n(an earlier view of the page, left out)"

/** Size, in characters, past which older views are dropped; about 15k tokens. */
const DEFAULT_TRANSCRIPT_BUDGET = 60_000

/** Provider options that mark a message as the end of a cached prefix. */
const BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" } } } as const

/** Text with the page view it carried replaced by the stub. */
function stubbed(text: string): string {
  const at = text.indexOf(VIEW_MARK)

  return at < 0 ? text : `${text.slice(0, at)}${STUB}`
}

/** What an older screenshot becomes once the conversation is compacted. */
const IMAGE_STUB = "(an earlier screenshot, left out)"

/** The message with its page views stubbed. */
function withoutViews(message: ModelMessage): ModelMessage {
  if (message.role === "user" && typeof message.content === "string")
    return { ...message, content: stubbed(message.content) }

  if (message.role === "user" && typeof message.content !== "string")
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image" || part.type === "file"
          ? { type: "text" as const, text: IMAGE_STUB }
          : part.type === "text"
            ? { ...part, text: stubbed(part.text) }
            : part,
      ),
    }

  if (message.role !== "tool") return message

  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool-result" && part.output.type === "text"
        ? { ...part, output: { type: "text", value: stubbed(part.output.value) } }
        : part,
    ),
  }
}

/** A screenshot counts as this many characters against the budget, about 1.5k tokens. */
const IMAGE_SIZE = 6_000

/** Characters of text a message carries; a screenshot counts as `IMAGE_SIZE`. */
function sizeOf(message: ModelMessage): number {
  if (typeof message.content === "string") return message.content.length

  return message.content.reduce(
    (sum, part) =>
      sum +
      (part.type === "image" || part.type === "file" ? IMAGE_SIZE : JSON.stringify(part).length),
    0,
  )
}

export class Transcript {
  private messages: ModelMessage[] = []
  private readonly budget: number
  private compactions = 0

  constructor(budget = DEFAULT_TRANSCRIPT_BUDGET) {
    this.budget = budget
  }

  push(...messages: readonly ModelMessage[]): void {
    this.messages.push(...messages)
  }

  /** How many times older views were dropped. */
  get compacted(): number {
    return this.compactions
  }

  /** Drops every view but the latest message's when the conversation is over its budget. */
  compactIfOver(): void {
    const size = this.messages.reduce((sum, message) => sum + sizeOf(message), 0)

    if (size <= this.budget || this.messages.length < 2) return

    const latest = this.messages.at(-1)

    this.messages = [...this.messages.slice(0, -1).map(withoutViews), ...(latest ? [latest] : [])]
    this.compactions++
  }

  /** The messages to send, the newest marked as a cache breakpoint. */
  forModel(): ModelMessage[] {
    const latest = this.messages.at(-1)

    if (latest === undefined) return []

    return [
      ...this.messages.slice(0, -1),
      { ...latest, providerOptions: { ...latest.providerOptions, ...BREAKPOINT } },
    ]
  }
}
