/**
 * Focusing a fault plan on what the test itself does. A real app's clean run makes hundreds of
 * calls and statements, most of them repeats, background work or the saved session signing in.
 * Planning a fault on every one gives thousands of trials; this narrows the plan step by step,
 * deterministically, only as far as it has to:
 *
 * 1. the test's body only: calls, deliveries, statements and sockets from before the body began
 *    (a saved session signing in, fixtures, `beforeEach`) are setup, and get no faults;
 * 2. while the plan is over its budget: background work dropped (health checks, metrics, static
 *    assets, token refreshes and job-runner housekeeping), then later occurrences of a route or
 *    statement folded into the first, then each target's faults thinned to the ones that matter
 *    most for it, then the plan cut at the budget, races, webhooks and writes first.
 *
 * A plan within its budget runs whole, so a small test keeps every fault it had.
 */
import type { DataCall } from "@danwo/infra"

import type { PlannedFault, RunOutcome } from "./fault-matrix.ts"

/**
 * What setup set off that came only once the body began, by place in the run's lists: a webhook a
 * sign-in or fixture sent that is delivered later, the calls and statements made while the app
 * handled it, the rest of a transaction setup opened. Places are indexes into the whole run's
 * `exchanges`, `deliveries`, `dataCalls` and `sockets`.
 */
export interface SetupCaused {
  readonly exchanges: readonly number[]
  readonly deliveries: readonly number[]
  readonly data: readonly number[]
  readonly sockets: readonly number[]
}

/**
 * How much of a clean run was setup rather than the test's body: the leading calls, deliveries
 * and sockets made before the body began, per data service its leading statements, and what
 * setup set off that came after.
 */
export interface SetupSpan {
  readonly exchanges: number
  readonly deliveries: number
  readonly sockets: number
  /** By data proxy service name. */
  readonly data: Readonly<Record<string, number>>
  readonly caused?: SetupCaused | undefined
}

/** The indexes of the data calls from each service's `skip`-th on, in their order. */
function dataAfter(calls: readonly DataCall[], skip: Readonly<Record<string, number>>): number[] {
  const seen = new Map<string, number>()

  return calls.flatMap((call, index) => {
    const at = seen.get(call.service) ?? 0

    seen.set(call.service, at + 1)

    return at >= (skip[call.service] ?? 0) ? [index] : []
  })
}

/** `places` moved into a list that keeps only the items at `kept` (whole-run indexes, in order). */
function rebased(places: readonly number[] | undefined, kept: readonly number[]): number[] {
  const at = new Map(kept.map((index, position) => [index, position]))

  return (places ?? []).flatMap((place) => at.get(place) ?? [])
}

/** The indexes from `from` up to `length`. */
function from(start: number, length: number): number[] {
  return Array.from({ length: Math.max(0, length - start) }, (_, offset) => start + offset)
}

/**
 * The clean run as its body saw it: everything from before the body began left out, and what
 * setup set off after it marked (`caused`). Faults planned from it count their occurrences from
 * the body's start, where a trial arms them, counting what setup set off but placing none on it.
 */
export function bodyOf(outcome: RunOutcome): RunOutcome {
  const { setup } = outcome

  if (setup === undefined) return outcome

  const sockets = from(setup.sockets, outcome.sockets?.length ?? 0)
  const data =
    outcome.dataCalls === undefined ? undefined : dataAfter(outcome.dataCalls, setup.data)

  return {
    ...outcome,
    exchanges: outcome.exchanges.slice(setup.exchanges),
    deliveries: outcome.deliveries.slice(setup.deliveries),
    sockets: outcome.sockets?.slice(setup.sockets),
    dataCalls: data?.flatMap((index) => outcome.dataCalls?.[index] ?? []),
    setup: undefined,
    caused: {
      exchanges: rebased(setup.caused?.exchanges, from(setup.exchanges, outcome.exchanges.length)),
      deliveries: rebased(
        setup.caused?.deliveries,
        from(setup.deliveries, outcome.deliveries.length),
      ),
      data: rebased(setup.caused?.data, data ?? []),
      sockets: rebased(setup.caused?.sockets, sockets),
    },
  }
}

/** How many calls, deliveries, statements and sockets a span holds in all, what setup set off included. */
export function setupSize(setup: SetupSpan | undefined): number {
  if (setup === undefined) return 0

  const data = Object.values(setup.data).reduce((sum, count) => sum + count, 0)
  const caused = setup.caused
  const later =
    (caused?.exchanges.length ?? 0) +
    (caused?.deliveries.length ?? 0) +
    (caused?.data.length ?? 0) +
    (caused?.sockets.length ?? 0)

  return setup.exchanges + setup.deliveries + setup.sockets + data + later
}

/**
 * Paths an app's infrastructure asks for on its own: health, readiness, metrics. Signing keys are
 * not among them: an app that cannot fetch them must refuse the tokens they would verify.
 */
const BACKGROUND_PATH =
  /(?:^|\/)(?:health|healthz|ready|readyz|livez|ping|metrics|favicon\.ico)(?:\/|$)/i

/** Static files a page loads: scripts, styles, fonts, images, maps. */
const ASSET_PATH = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i

/** A browser session keeping itself fresh: token refreshes and touches. */
const REFRESH_PATH = /\/(?:tokens|touch|refresh)$/i

/** A background job runner's own traffic: registering functions, checkpoints, realtime feeds. */
const JOB_RUNNER_PATH = /\/(?:fn\/register|api\/inngest|v\d\/(?:checkpoint|realtime)[^ ]*)$/i

/** The path part of an `outbound` route (`POST host/path` → `/path`). */
function routePath(route: string): string {
  const target = route.slice(route.indexOf(" ") + 1)
  const slash = target.indexOf("/")

  return slash < 0 ? "/" : target.slice(slash)
}

/** Whether a planned fault lands on work the test does not cause: it is dropped by default. */
export function isBackground(planned: PlannedFault): boolean {
  if (planned.target !== "outbound" || planned.fault.kind === "slow-then-retry") return false

  const path = routePath(planned.route)

  return [BACKGROUND_PATH, ASSET_PATH, REFRESH_PATH, JOB_RUNNER_PATH].some((pattern) =>
    pattern.test(path),
  )
}

const READ_METHODS = /^(?:GET|HEAD|OPTIONS) /
const DATA_WRITE =
  /^(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|COMMIT|SET|HSET|INCR|DECR|DEL|LPUSH|RPUSH|SADD|ZADD|EXPIRE)\b/i

/**
 * Where a planned fault ranks when the plan has to be cut, lower first: races and webhooks (what
 * the test's effects hang on), then writes to providers and the database, then sockets, then
 * reads.
 */
export function tierOf(planned: PlannedFault): number {
  switch (planned.target) {
    case "page":
    case "users":
    case "redirect":
    case "webhook":
      return 0
    case "data":
      return DATA_WRITE.test(planned.operation) ? 1 : 3
    case "socket":
      return 2
    default:
      return planned.fault.kind === "slow-then-retry" || !READ_METHODS.test(planned.route) ? 1 : 3
  }
}

/** What a fault is placed on, without which occurrence: a route, a statement, a topic, a socket. */
function placeOf(planned: PlannedFault): string {
  if ("route" in planned) return `${planned.target} ${planned.route}`
  if (planned.target === "data") return `data ${planned.service} ${planned.operation}`
  if (planned.target === "webhook") return `webhook ${planned.service ?? ""} ${planned.topic}`

  return planned.target === "redirect" ? `redirect ${planned.via?.route ?? ""}` : planned.target
}

/** Which occurrence of its place a fault lands on; races on the whole run have none. */
function occurrenceOf(planned: PlannedFault): number {
  return "occurrence" in planned ? planned.occurrence : 0
}

/**
 * How much each kind of fault says about the call it lands on, lower first: a provider's own
 * refusal (a decline) and a 5xx, then the answer lost after the provider acted, then slowness.
 */
const OUTBOUND_RANK: Readonly<Record<string, number>> = {
  emulate: 0,
  status: 1,
  "reset-after": 2,
  delay: 3,
  "slow-then-retry": 3,
}

/** The same for statements: a write that ran but whose answer was lost, then an error, then an outage. */
const DATA_RANK: Readonly<Record<string, number>> = { "reset-after": 0, error: 1, down: 2 }

/** The same for webhooks: a repeat, a forgery, a late one, the wrong order. */
const WEBHOOK_RANK: Readonly<Record<string, number>> = {
  duplicate: 0,
  forged: 1,
  delay: 2,
  after: 3,
}

/** How much a fault kind says about its target, lower first, when a target's faults are thinned. */
function kindRank(planned: PlannedFault): number {
  const rank =
    planned.target === "outbound"
      ? OUTBOUND_RANK
      : planned.target === "data"
        ? DATA_RANK
        : planned.target === "webhook"
          ? WEBHOOK_RANK
          : undefined

  if (rank === undefined || !("fault" in planned)) return 0

  return rank[planned.fault.kind] ?? Object.keys(rank).length
}

/** How many faults a target keeps once thinned: more for writes and webhooks than for reads. */
function keepPerTarget(planned: PlannedFault): number {
  if (planned.target === "webhook") return 3

  return tierOf(planned) === 3 ? 2 : planned.target === "data" ? 2 : 3
}

/** How a plan's faults are focused; every field has a default. */
export interface FocusOptions {
  /** Most trials to run (default 40). Ignored with `all`. */
  readonly budget?: number
  /** Every fault on the body, background included, with no budget. */
  readonly all?: boolean
  /** Every fault kind on each target, rather than the ones that matter most for it. */
  readonly thorough?: boolean
  /** Faults on every occurrence of a route or statement, not only its first. */
  readonly everyOccurrence?: boolean
}

/** A focused plan: the trials to run, and what was left out and why. */
export interface FocusedPlan {
  readonly trials: readonly PlannedFault[]
  /** Faults the whole run allowed, setup included. */
  readonly total: number
  readonly skipped: {
    /** Faults on setup: the saved session signing in, fixtures, `beforeEach`. */
    readonly setup: number
    /** Faults on health checks, assets, token refreshes and job-runner housekeeping. */
    readonly background: number
    /** Faults on later occurrences of a route or statement already faulted on its first. */
    readonly repeats: number
    /** Lesser fault kinds on a target that keeps its main ones. */
    readonly kinds: number
    /** Labels of faults that ranked below the budget's cut. */
    readonly budget: readonly string[]
  }
}

/** The default most trials a matrix runs. */
export const DEFAULT_BUDGET = 40

/** Keeps the first occurrence of each place; the number dropped. */
function foldRepeats(plan: readonly PlannedFault[]): { kept: PlannedFault[]; dropped: number } {
  const kept = plan.filter((planned) => occurrenceOf(planned) === 0)

  return { kept, dropped: plan.length - kept.length }
}

/** Keeps each target's most telling fault kinds; the number dropped. */
function thinKinds(plan: readonly PlannedFault[]): { kept: PlannedFault[]; dropped: number } {
  const groups = new Map<string, PlannedFault[]>()

  for (const planned of plan) {
    const key = `${placeOf(planned)}#${occurrenceOf(planned)}`

    groups.set(key, [...(groups.get(key) ?? []), planned])
  }

  const keep = new Set<PlannedFault>()

  for (const group of groups.values()) {
    const ranked = group
      .map((planned, at) => ({ planned, at }))
      .toSorted((a, b) => kindRank(a.planned) - kindRank(b.planned) || a.at - b.at)
    const [first] = group

    if (first === undefined) continue
    for (const { planned } of ranked.slice(0, keepPerTarget(first))) keep.add(planned)
  }

  const kept = plan.filter((planned) => keep.has(planned))

  return { kept, dropped: plan.length - kept.length }
}

/** The first `budget` faults by tier, in plan order within a tier; the labels left out. */
function cut(
  plan: readonly PlannedFault[],
  budget: number,
): { kept: PlannedFault[]; out: string[] } {
  const ranked = plan
    .map((planned, at) => ({ planned, at }))
    .toSorted((a, b) => tierOf(a.planned) - tierOf(b.planned) || a.at - b.at)
  const chosen = new Set(ranked.slice(0, budget).map(({ planned }) => planned))

  return {
    kept: plan.filter((planned) => chosen.has(planned)),
    out: ranked.slice(budget).map(({ planned }) => planned.label),
  }
}

/**
 * Narrows `body` (the faults planned on the test's body) under `options`. `setup` is how many
 * faults the run's setup would have had, for the summary.
 */
export function focusPlan(
  body: readonly PlannedFault[],
  setup: number,
  options: FocusOptions = {},
): FocusedPlan {
  const total = body.length + setup
  const nothing = { setup, background: 0, repeats: 0, kinds: 0, budget: [] }

  if (options.all === true) return { trials: [...body], total, skipped: nothing }

  const budget = Math.max(1, Math.floor(options.budget ?? DEFAULT_BUDGET))
  let plan = [...body]
  let background = 0
  let repeats = 0
  let kinds = 0

  if (plan.length > budget) {
    plan = plan.filter((planned) => !isBackground(planned))
    background = body.length - plan.length
  }

  if (plan.length > budget && options.everyOccurrence !== true) {
    const folded = foldRepeats(plan)

    plan = folded.kept
    repeats = folded.dropped
  }

  if (plan.length > budget && options.thorough !== true) {
    const thinned = thinKinds(plan)

    plan = thinned.kept
    kinds = thinned.dropped
  }

  const { kept, out } = cut(plan, budget)

  return { trials: kept, total, skipped: { setup, background, repeats, kinds, budget: out } }
}

/** The plan summary in a few lines, for the console and `danwo matrix --plan`. */
export function focusLines(focused: FocusedPlan): string[] {
  const { skipped } = focused
  const parts = [
    skipped.setup > 0 ? `${skipped.setup} on setup` : undefined,
    skipped.background > 0 ? `${skipped.background} on background work` : undefined,
    skipped.repeats > 0 ? `${skipped.repeats} on repeats of a route or statement` : undefined,
    skipped.kinds > 0 ? `${skipped.kinds} lesser fault kinds` : undefined,
    skipped.budget.length > 0 ? `${skipped.budget.length} over the budget` : undefined,
  ].filter((part) => part !== undefined)

  return parts.length === 0
    ? []
    : [
        `${focused.total - focused.trials.length} of ${focused.total} possible faults left out: ${parts.join(", ")}`,
      ]
}
