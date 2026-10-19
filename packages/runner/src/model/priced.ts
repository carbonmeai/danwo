/**
 * Prices for a model whose provider does not say what a call cost. The AI Gateway bills each
 * call and says so; a provider's own API (Anthropic, OpenAI, Google, an OpenAI-compatible server)
 * reports tokens only. `priced` turns those tokens into dollars, so run summaries show spend and a
 * dollar budget can stop a step.
 */
import type { LanguageModelV4, LanguageModelV4Usage } from "@ai-sdk/provider"
import { type LanguageModel, wrapLanguageModel } from "ai"

/** Dollars per million tokens. */
export interface ModelPrice {
  readonly input: number
  readonly output: number
  /** For input tokens read from the provider's prompt cache; default the input price. */
  readonly cachedInput?: number
}

/** The key a priced call's cost sits under in its provider metadata. */
export const PRICE_METADATA_KEY = "danwo"

/** What a call with `usage` costs at `price`, in dollars. */
function costOf(usage: LanguageModelV4Usage, price: ModelPrice): number {
  const cached = usage.inputTokens.cacheRead ?? 0
  const input = (usage.inputTokens.total ?? 0) - cached
  const output = usage.outputTokens.total ?? 0

  return (
    (input * price.input + cached * (price.cachedInput ?? price.input) + output * price.output) /
    1e6
  )
}

/**
 * `model` with each call's cost worked out from `price`, e.g.
 * `priced(anthropic("claude-sonnet-5"), { input: 3, output: 15 })`. A call whose provider already
 * says what it cost keeps that figure.
 */
export function priced(model: Exclude<LanguageModel, string>, price: ModelPrice): LanguageModelV4 {
  return wrapLanguageModel({
    model,
    middleware: {
      async wrapGenerate({ doGenerate }) {
        const result = await doGenerate()

        return {
          ...result,
          providerMetadata: {
            ...result.providerMetadata,
            [PRICE_METADATA_KEY]: { cost: costOf(result.usage, price) },
          },
        }
      },
    },
  })
}
