/**
 * How long checks took in a run that passed, so a later run of the same steps waits for each check
 * only a few times as long. A `danwo matrix` trial replays its clean run's steps exactly; when a
 * fault makes a checked state impossible, the check fails in about a second instead of waiting out
 * its whole timeout for something that will not come.
 */
import type { StepRecord } from "../record/steps.ts"

/** Check timings from a passing run, and how much longer a later run may wait for each. */
export interface CheckPace {
  /** Milliseconds each passing check took, by `checkKey`. */
  readonly took: Readonly<Record<string, number>>
  /** A check waits at most this many times as long as it took before (default 3). */
  readonly factor?: number
  /** And never less than this, in milliseconds (default 1000). */
  readonly floorMs?: number
}

const DEFAULT_FACTOR = 3
const DEFAULT_FLOOR_MS = 1000
/** Added to every paced wait, so a check that took no time still gets a moment. */
const SLACK_MS = 500

/** Names a check by where it ran in its attempt: the step's index, its API and its call. */
export function checkKey(index: number, api: string, label: string): string {
  return `${index} ${api} ${label}`
}

/**
 * How long a check may wait: what it took in the paced run, scaled, within `fallback` (its normal
 * timeout). A check the paced run never made keeps its normal timeout.
 */
export function pacedTimeout(pace: CheckPace, key: string, fallback: number): number {
  const took = pace.took[key]

  if (took === undefined) return fallback

  const paced = Math.max(pace.floorMs ?? DEFAULT_FLOOR_MS, took * (pace.factor ?? DEFAULT_FACTOR))

  return Math.min(fallback, Math.round(paced + SLACK_MS))
}

/** The time every check that passed took in `steps`, by `checkKey`. */
export function paceOf(steps: readonly StepRecord[]): Record<string, number> {
  return Object.fromEntries(
    steps
      .filter((step) => step.kind === "assertion" && step.status === "passed")
      .map((step) => [checkKey(step.index, step.api, step.label), step.durationMs]),
  )
}
