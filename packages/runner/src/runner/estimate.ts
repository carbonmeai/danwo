/**
 * How long a matrix's faulted trials will take, as `--plan` says before running them. Each trial
 * is built from the clean trial's phases: getting back to the starting state (a restore when the
 * environment keeps snapshots, else a reset), opening the browser, the body under its fault, the
 * invariant, settling and closing. Trials are then laid out over the crew the way the pool hands
 * them out, each worker but the clean trial's paying its own start and first reset. A fault that
 * breaks the run can stop its body early, so the answer is a range.
 */
import type { PlannedFault } from "@danwo/matrix"

import type { TrialTimings } from "./timings.ts"

/** What the clean run measured that the faulted trials repeat. */
export interface CleanCost {
  /** The clean trial's phases; its `prepare` is a worker's first reset, and snapshot when kept. */
  readonly timings: TrialTimings
  /** The clean run's time outside its phases: starting the worker, its app and its browser. */
  readonly startMs: number
  /** One restore of the kept starting state; absent when the environment resets every trial. */
  readonly restoreMs?: number | undefined
}

/** The fastest and slowest the trials are likely to take, in milliseconds. */
export interface TrialsEstimate {
  readonly lowMs: number
  readonly highMs: number
}

/**
 * How a fault changes a trial's body: the share of the clean body it runs at least, and the
 * milliseconds it adds at least and at most.
 */
interface BodyEffect {
  readonly least: number
  readonly addedLow: number
  readonly addedHigh: number
}

/** A body that runs as the clean one did. */
const AS_CLEAN: BodyEffect = { least: 1, addedLow: 0, addedHigh: 0 }

/**
 * The share of its body a breaking fault runs at least: a faulted trial stops at its first
 * breaking step, which is seldom the last.
 */
const BREAKING_SHARE = 0.25

/** A fault that breaks the run when the app does not recover from it. */
const BREAKING: BodyEffect = { least: BREAKING_SHARE, addedLow: 0, addedHigh: 0 }

/**
 * The most a delay holds a trial up, at least and at most. A faulted trial waits for each check
 * only a few times as long as the clean one did, so a long delay (a webhook ten minutes late)
 * ends in a failed check, not in waiting it out: the shortest paced wait, and a long one.
 */
const DELAY_HOLDS_MS = { least: 1500, most: 10_000 } as const

/** The time a `ms` delay adds to the body, at least and at most. */
function delayed(ms: number, least: number): BodyEffect {
  return {
    least,
    addedLow: least === 1 ? Math.min(ms, DELAY_HOLDS_MS.least) : 0,
    addedHigh: Math.min(ms, DELAY_HOLDS_MS.most),
  }
}

/** The fault a planned fault places, when it places one rather than setting up a race. */
type Placed = Extract<PlannedFault, { readonly fault: unknown }>["fault"]

/** What each kind of placed fault does to the body's time; a kind not here leaves it as clean. */
const EFFECTS: Readonly<Record<string, (fault: Placed) => BodyEffect>> = {
  delay: (fault) => delayed(msOf(fault), 1),
  "slow-then-retry": (fault) => delayed(msOf(fault), 1),
  down: (fault) => delayed(msOf(fault), BREAKING_SHARE),
  status: (fault) => (fault.kind === "status" && fault.status >= 400 ? BREAKING : AS_CLEAN),
  reset: () => BREAKING,
  "reset-after": () => BREAKING,
  error: () => BREAKING,
  refuse: () => BREAKING,
}

/** The milliseconds a fault holds its call or delivery for; 0 for one that holds nothing. */
function msOf(fault: Placed): number {
  return "ms" in fault ? fault.ms : 0
}

/** What `planned` does to the body's time; races run the body as the clean trial did. */
function bodyEffect(planned: PlannedFault): BodyEffect {
  if (!("fault" in planned)) return AS_CLEAN

  return EFFECTS[planned.fault.kind]?.(planned.fault) ?? AS_CLEAN
}

/** The longest any worker is busy when `durations` are handed out in order to whichever is free. */
function makespan(durations: readonly number[], workers: number, coldExtra: number): number {
  const lanes = Array.from({ length: Math.max(1, Math.min(workers, durations.length)) }, () => 0)

  durations.forEach((ms, index) => {
    // The first trial on each worker but the clean trial's starts that worker cold.
    const extra = index > 0 && index < lanes.length ? coldExtra : 0
    const lane = lanes.indexOf(Math.min(...lanes))

    lanes[lane] = (lanes[lane] ?? 0) + ms + extra
  })

  return Math.max(...lanes)
}

/** How long `plan`'s trials take on `workers`, from what the clean run measured. */
export function estimateTrials(
  plan: readonly PlannedFault[],
  clean: CleanCost,
  workers: number,
): TrialsEstimate {
  if (plan.length === 0) return { lowMs: 0, highMs: 0 }

  const { timings } = clean
  const prepare = clean.restoreMs ?? timings.prepare
  const around = prepare + timings.open + timings.invariant + timings.settle + timings.close
  // A cold worker starts, then resets (and snapshots) where a warm one restores.
  const coldExtra = clean.startMs + timings.prepare - prepare
  const effects = plan.map(bodyEffect)
  const low = effects.map((e) => around + timings.body * e.least + e.addedLow)
  const high = effects.map((e) => around + timings.body + e.addedHigh)

  return {
    lowMs: Math.round(makespan(low, workers, coldExtra)),
    highMs: Math.round(makespan(high, workers, coldExtra)),
  }
}

/** A duration as people say it: seconds under two minutes, else whole minutes. */
function spoken(ms: number, unit: "s" | "min"): number {
  return unit === "s" ? Math.max(1, Math.round(ms / 1000)) : Math.max(1, Math.round(ms / 60_000))
}

/** The estimate as `--plan` prints it: `about 3–5 min`, or `about 40–70 s` for a short one. */
export function estimateText(estimate: TrialsEstimate): string {
  const unit = estimate.highMs < 120_000 ? "s" : "min"
  const low = spoken(estimate.lowMs, unit)
  const high = spoken(estimate.highMs, unit)

  return low === high ? `about ${low} ${unit}` : `about ${low}–${high} ${unit}`
}
