/**
 * A scripted stand-in for the judge: it answers each call with the next of its scripted replies,
 * as raw text, so tests can give it verdicts, evidence, or answers that hold no verdict at all.
 */
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"

import { text } from "./scripted.ts"

const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function answer(value: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: value }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  }
}

/** A verdict as the judge writes it. */
export function verdict(
  value: "holds" | "fails" | "blocked" | "inconclusive",
  evidence?: string,
): string {
  return JSON.stringify({ verdict: value, reason: `it ${value}`, ...(evidence && { evidence }) })
}

/**
 * A judge that gives `replies` in order, one per call; the last one repeats. Each reply may read
 * the page it was shown.
 */
export function judging(replies: readonly (string | ((page: string) => string))[]) {
  const pages: string[] = []
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted-judge",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const page = text(options.prompt.filter((message) => message.role !== "system"))
      const reply = replies[Math.min(pages.length, replies.length - 1)] ?? verdict("holds")

      pages.push(page)

      return answer(typeof reply === "string" ? reply : reply(page))
    },
  })

  return Object.assign(model, { pages })
}
