/**
 * Where a matrix trial's time goes, phase by phase, so a slow matrix says what to speed up:
 * getting the environment back to its starting state, opening the browser context, the test's
 * body and invariant, letting background work settle, and closing the attempt down.
 */

/** The phases of one trial, in the order they run. */
export const TRIAL_PHASES = ["prepare", "open", "body", "invariant", "settle", "close"] as const

export type TrialPhase = (typeof TRIAL_PHASES)[number]

/** Milliseconds spent in each phase of one trial. */
export type TrialTimings = Readonly<Record<TrialPhase, number>>

/** Milliseconds since `start` (a `performance.now()` reading), rounded. */
function since(start: number): number {
  return Math.round(performance.now() - start)
}

/** Runs `work` and adds its milliseconds to `phase` of `into`. */
export async function timed<T>(
  into: Record<TrialPhase, number>,
  phase: TrialPhase,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now()

  try {
    return await work()
  } finally {
    into[phase] += since(start)
  }
}

/** Every phase at zero, to add measurements to. */
export function noTimings(): Record<TrialPhase, number> {
  return { prepare: 0, open: 0, body: 0, invariant: 0, settle: 0, close: 0 }
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
}

/** Each phase's median over `trials`. */
export function medianTimings(trials: readonly TrialTimings[]): TrialTimings {
  const result = noTimings()

  for (const phase of TRIAL_PHASES) result[phase] = median(trials.map((t) => t[phase]))

  return result
}

/** The run's `trial time:` line: each phase's median and the median trial's total. */
export function timingsLine(trials: readonly TrialTimings[]): string | undefined {
  if (trials.length === 0) return undefined

  const medians = medianTimings(trials)
  const total = median(trials.map((t) => TRIAL_PHASES.reduce((sum, p) => sum + t[p], 0)))
  const parts = TRIAL_PHASES.map((phase) => `${phase} ${medians[phase]} ms`)

  return `trial time (median of ${trials.length}): ${total} ms · ${parts.join(" · ")}`
}
