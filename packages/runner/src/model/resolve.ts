/** Which model a session's agent runs on, and what each call cost. */
import { gateway, type LanguageModel, type LanguageModelUsage, type ProviderMetadata } from "ai"

/** A model instance; an id such as `"anthropic/claude-sonnet-5"` goes through the AI Gateway. */
export function resolveModel(model: LanguageModel): Exclude<LanguageModel, string> {
  return typeof model === "string" ? gateway(model) : model
}

export interface CallCost {
  readonly inputTokens: number
  readonly outputTokens: number
  /** What the gateway billed, in US dollars, when it says. */
  readonly costUsd?: number
}

function gatewayCost(metadata: ProviderMetadata | undefined): number | undefined {
  const raw = metadata?.["gateway"]?.["cost"]
  const cost = typeof raw === "string" ? Number(raw) : raw

  return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined
}

/** Tokens and cost of one model call. */
export function callCost(
  usage: LanguageModelUsage,
  metadata: ProviderMetadata | undefined,
): CallCost {
  const costUsd = gatewayCost(metadata)

  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    ...(costUsd !== undefined && { costUsd }),
  }
}
