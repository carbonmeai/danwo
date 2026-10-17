/**
 * What an attempt's agent steps cost and how they used the replay cache, summed from its step
 * records: the counts behind the run summary's `cache:` and `model:` lines and the per-step cost
 * table of the flight report.
 */
import { CACHE_OUTCOMES, type CacheOutcome, type StepRecord } from "./steps.ts"

/** How many steps came to each cache outcome. */
export type CacheCounts = Readonly<Partial<Record<CacheOutcome, number>>>

/** Model calls and what they took: tokens each way, and dollars as the gateway billed them. */
export interface Spent {
  readonly calls: number
  /** Of the calls, those that asked again after an answer could not be used. */
  readonly retries: number
  readonly tokens: readonly [input: number, output: number]
  readonly usd: number
}

const NOTHING: Spent = { calls: 0, retries: 0, tokens: [0, 0], usd: 0 }

/** Two amounts spent, together. */
function plus(a: Spent, b: Spent): Spent {
  return {
    calls: a.calls + b.calls,
    retries: a.retries + b.retries,
    tokens: [a.tokens[0] + b.tokens[0], a.tokens[1] + b.tokens[1]],
    usd: a.usd + b.usd,
  }
}

/** One agent step's share of the model calls. */
export interface StepCost {
  readonly step: Pick<StepRecord, "index" | "label" | "api"> & { readonly cache?: CacheOutcome }
  readonly spent: Spent
}

/** An attempt's use of the cache and the model. */
export interface Usage {
  readonly cache: CacheCounts
  readonly spent: Spent
  /** The agent steps that called the model, in order. */
  readonly steps: readonly StepCost[]
}

/** The model calls one step made, summed. */
export function stepCost(step: StepRecord): StepCost {
  const spent = step.events.reduce(
    (sum, event) =>
      event.kind === "model"
        ? plus(sum, {
            calls: 1,
            retries: event.retry === true ? 1 : 0,
            tokens: [event.inputTokens, event.outputTokens],
            usd: event.costUsd ?? 0,
          })
        : sum,
    NOTHING,
  )

  return {
    step: {
      index: step.index,
      label: step.label,
      api: step.api,
      ...(step.cache && { cache: step.cache.mode }),
    },
    spent,
  }
}

/** Counts added up by outcome. */
function countsOf(all: readonly CacheCounts[]): CacheCounts {
  const counts: Partial<Record<CacheOutcome, number>> = {}

  for (const one of all)
    for (const mode of CACHE_OUTCOMES) {
      const n = one[mode]

      if (n !== undefined) counts[mode] = (counts[mode] ?? 0) + n
    }

  return counts
}

/** The usage of an attempt's steps. */
export function usageOf(steps: readonly StepRecord[]): Usage {
  const costs = steps.map(stepCost).filter((cost) => cost.spent.calls > 0)

  return {
    cache: countsOf(
      steps.flatMap((step) => (step.cache === undefined ? [] : [{ [step.cache.mode]: 1 }])),
    ),
    spent: costs.reduce((sum, cost) => plus(sum, cost.spent), NOTHING),
    steps: costs,
  }
}

/** Several attempts' usage added up; their per-step lists are joined. */
export function addUsage(all: readonly Usage[]): Usage {
  return {
    cache: countsOf(all.map((usage) => usage.cache)),
    spent: all.reduce((sum, usage) => plus(sum, usage.spent), NOTHING),
    steps: all.flatMap((usage) => usage.steps),
  }
}

const WORDS: Readonly<Record<CacheOutcome, string>> = {
  replayed: "replayed",
  relocated: "relocated",
  "handed-off": "handed off",
  missed: "missed",
  stale: "stale",
  diverged: "diverged",
  off: "off",
}

/** The outcomes always listed, even at 0; the rest only when they happened. */
const ALWAYS: readonly CacheOutcome[] = ["replayed", "relocated", "handed-off", "missed"]

/** `cache: 12 replayed · 1 relocated · 1 handed off · 0 missed`, or undefined with no agent steps. */
export function cacheLine(counts: CacheCounts): string | undefined {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)

  if (total === 0) return undefined

  const parts = CACHE_OUTCOMES.filter(
    (mode) => mode !== "off" && (ALWAYS.includes(mode) || (counts[mode] ?? 0) > 0),
  ).map((mode) => `${counts[mode] ?? 0} ${WORDS[mode]}`)

  return `cache: ${parts.join(" · ")}`
}

/** Thousands as `k`, for token counts. */
function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Dollars, with enough places for the small costs of a test run. */
export function dollars(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`
}

/** `48.2k in / 3.1k out`. */
export function tokensText(spent: Spent): string {
  return `${tokens(spent.tokens[0])} in / ${tokens(spent.tokens[1])} out`
}

/** `model: 14 calls · 48.2k in / 3.1k out · $0.0312`, or undefined when no step called it. */
export function modelLine(usage: Usage): string | undefined {
  const { spent } = usage

  if (spent.calls === 0) return undefined

  const cost = spent.usd > 0 ? ` · ${dollars(spent.usd)}` : ""
  const retries = spent.retries > 0 ? ` (${spent.retries} asked again)` : ""
  const calls = `${spent.calls} call${spent.calls === 1 ? "" : "s"}${retries}`

  return `model: ${calls} · ${tokensText(spent)}${cost}`
}
