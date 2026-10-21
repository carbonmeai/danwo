/**
 * The conversation's messages as the page shows them and Postgres keeps them: the AI SDK's UI
 * messages, typed by the assistant's tools, each answer carrying how it ended.
 */
import type { FinishReason, InferUITools, UIMessage } from "ai"

import type { SupportTools } from "./assistant.ts"

/**
 * How an answer ended: in full, refused (or stopped by a content filter), cut short by the token
 * limit, with nothing in it, or broken off before the model finished.
 */
export type Outcome = "answered" | "refused" | "cut-short" | "empty" | "interrupted"

/** What each answer carries besides its parts. */
export interface SupportMetadata {
  readonly outcome?: Outcome
}

export type SupportMessage = UIMessage<SupportMetadata, never, InferUITools<SupportTools>>

/**
 * How an answer ended, from the model's finish reason and whether it said or did anything: a
 * stream that broke off ends with no reason the model gave (`other`), or with none at all.
 */
export function outcomeOf(reason: FinishReason | undefined, saidSomething: boolean): Outcome {
  if (reason === "content-filter") return "refused"
  if (reason === "length") return "cut-short"
  if (reason !== "stop" && reason !== "tool-calls") return "interrupted"

  return saidSomething ? "answered" : "empty"
}

/** What the page says under an answer that didn't end in full; nothing for one that did. */
export const OUTCOME_NOTES: Readonly<Record<Outcome, string | undefined>> = {
  answered: undefined,
  refused: "The assistant declined to answer this.",
  "cut-short": "This answer was cut short.",
  empty: "The assistant didn't reply.",
  interrupted: "This answer was interrupted before it finished.",
}

/** The text a message shows, its text parts joined. */
export function textOf(message: Pick<SupportMessage, "parts">): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim()
}
