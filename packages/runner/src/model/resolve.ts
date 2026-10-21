/** Which model a session's agent runs on, and what each call cost. */
import { gateway, type LanguageModel, type LanguageModelUsage, type ProviderMetadata } from "ai"

import { PRICE_METADATA_KEY } from "./priced.ts"

/** A model instance; an id such as `"anthropic/claude-sonnet-5"` goes through the AI Gateway. */
export function resolveModel(model: LanguageModel): Exclude<LanguageModel, string> {
  return typeof model === "string" ? gateway(model) : model
}

/**
 * The model's name as a recording keeps it: its id, as `openai/gpt-5-mini`. A model instance is
 * named by its provider and id, unless its id already names the provider (the AI Gateway's do).
 */
export function modelName(model: LanguageModel | undefined): string | undefined {
  if (model === undefined) return undefined
  if (typeof model === "string") return model
  if (model.modelId.includes("/")) return model.modelId

  const provider = model.provider.split(".")[0] ?? model.provider

  return `${provider}/${model.modelId}`
}

export interface CallCost {
  readonly inputTokens: number
  readonly outputTokens: number
  /** Of the input, tokens the provider read from its prompt cache, when it says. */
  readonly cachedInputTokens?: number
  /** What the call cost in US dollars: as the gateway billed it, or from `priced` prices. */
  readonly costUsd?: number
  /** The call asked again after the model's last answer could not be used. */
  readonly retry?: boolean
}

/** A cost the provider metadata carries under `key`, as a number. */
function costUnder(metadata: ProviderMetadata | undefined, key: string): number | undefined {
  const raw = metadata?.[key]?.["cost"]
  const cost = typeof raw === "string" ? Number(raw) : raw

  return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined
}

/** Tokens and cost of one model call; the gateway's bill wins over a `priced` estimate. */
export function callCost(
  usage: LanguageModelUsage,
  metadata: ProviderMetadata | undefined,
): CallCost {
  const costUsd = costUnder(metadata, "gateway") ?? costUnder(metadata, PRICE_METADATA_KEY)
  const cached = usage.inputTokenDetails?.cacheReadTokens

  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    ...(cached !== undefined && { cachedInputTokens: cached }),
    ...(costUsd !== undefined && { costUsd }),
  }
}
