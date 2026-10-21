/**
 * What an attempt's agent steps cost and how they used the replay cache, summed from its step
 * records: the counts behind the run summary's `cache:` and `model:` lines and the per-step cost
 * table of the flight report.
 */
import {
  CACHE_OUTCOMES,
  type CacheOutcome,
  type RecordingFate,
  recordingText,
  type StepRecord,
} from "./steps.ts"

/** How many steps came to each cache outcome. */
export type CacheCounts = Readonly<Partial<Record<CacheOutcome, number>>>

/** How many new recordings came to each fate. */
export type RecordingCounts = Readonly<Partial<Record<RecordingFate, number>>>

/** Every fate, in the order the `cache:` line lists them. */
const FATES: readonly RecordingFate[] = ["kept", "staged", "test-failed", "unchecked"]

/** Steps that replayed a recording another model made, by the pair of models. */
export interface ModelSwap {
  readonly recordedWith: string
  readonly runningWith: string
  readonly steps: number
}

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
  /** What became of the new recordings the steps made; absent in older reports. */
  readonly recordings?: RecordingCounts
  /** Replays of recordings another model made; absent when there were none. */
  readonly models?: readonly ModelSwap[]
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

/** Counts added up by key. */
function countsOf<Key extends string>(
  all: readonly Readonly<Partial<Record<Key, number>>>[],
  keys: readonly Key[],
): Partial<Record<Key, number>> {
  const counts: Partial<Record<Key, number>> = {}

  for (const one of all)
    for (const key of keys) {
      const n = one[key]

      if (n !== undefined) counts[key] = (counts[key] ?? 0) + n
    }

  return counts
}

/** A step's new recording by its fate; a recording written at once counts as kept. */
function fateOf(step: StepRecord): RecordingFate | undefined {
  if (step.cache === undefined) return undefined

  return step.cache.recording ?? (step.cache.saved === true ? "kept" : undefined)
}

/** Swaps added up by their pair of models, in the order each pair first came. */
function swapsOf(all: readonly ModelSwap[]): ModelSwap[] {
  const pairs = new Map<string, ModelSwap>()

  for (const swap of all) {
    const pair = JSON.stringify([swap.recordedWith, swap.runningWith])
    const steps = (pairs.get(pair)?.steps ?? 0) + swap.steps

    pairs.set(pair, { ...swap, steps })
  }

  return [...pairs.values()]
}

/** The step's model swap, when it replayed another model's recording. */
function swapOf(step: StepRecord): ModelSwap[] {
  const { recordedWith, runningWith } = step.cache ?? {}

  return recordedWith === undefined || runningWith === undefined
    ? []
    : [{ recordedWith, runningWith, steps: 1 }]
}

/** `models`, only when there were any. */
function withModels(swaps: readonly ModelSwap[]): Pick<Usage, "models"> {
  return swaps.length === 0 ? {} : { models: swaps }
}

/** The usage of an attempt's steps. */
export function usageOf(steps: readonly StepRecord[]): Usage {
  const costs = steps.map(stepCost).filter((cost) => cost.spent.calls > 0)

  return {
    ...withModels(swapsOf(steps.flatMap(swapOf))),
    cache: countsOf(
      steps.flatMap((step) => (step.cache === undefined ? [] : [{ [step.cache.mode]: 1 }])),
      CACHE_OUTCOMES,
    ),
    recordings: countsOf(
      steps.flatMap((step) => {
        const fate = fateOf(step)

        return fate === undefined ? [] : [{ [fate]: 1 }]
      }),
      FATES,
    ),
    spent: costs.reduce((sum, cost) => plus(sum, cost.spent), NOTHING),
    steps: costs,
  }
}

/** Several attempts' usage added up; their per-step lists are joined. */
export function addUsage(all: readonly Usage[]): Usage {
  return {
    ...withModels(swapsOf(all.flatMap((usage) => usage.models ?? []))),
    cache: countsOf(
      all.map((usage) => usage.cache),
      CACHE_OUTCOMES,
    ),
    recordings: countsOf(
      all.map((usage) => usage.recordings ?? {}),
      FATES,
    ),
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

/**
 * `cache: 12 replayed · 1 relocated · 1 handed off · 2 missed · 2 recorded`, or undefined with no
 * agent steps. New recordings are listed by what became of them: `recorded`, or `not kept` and why.
 * Replays of recordings another model made end the line, as `recorded with openai/gpt-5-mini
 * (4 steps), running anthropic/claude-sonnet-5`: no model ran for them, so the configured one is
 * untried there.
 */
export function cacheLine(
  counts: CacheCounts,
  recordings: RecordingCounts = {},
  models: readonly ModelSwap[] = [],
): string | undefined {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)

  if (total === 0) return undefined

  const parts = CACHE_OUTCOMES.filter(
    (mode) => mode !== "off" && (ALWAYS.includes(mode) || (counts[mode] ?? 0) > 0),
  ).map((mode) => `${counts[mode] ?? 0} ${WORDS[mode]}`)
  const fates = FATES.filter((fate) => (recordings[fate] ?? 0) > 0).map(
    (fate) => `${recordings[fate]} ${recordingText({ recording: fate })}`,
  )
  const swaps = models.map(
    (swap) =>
      `recorded with ${swap.recordedWith} (${swap.steps} step${swap.steps === 1 ? "" : "s"}), running ${swap.runningWith}`,
  )

  return `cache: ${[...parts, ...fates, ...swaps].join(" · ")}`
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
