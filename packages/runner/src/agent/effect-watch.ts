/**
 * Watching one agent step's effects: a view of the page and a mark in the backend's history when
 * the step starts, and what changed by the time it ends. A recording keeps what the step changed; a
 * replay of it must change the same, or it diverged even though every action ran.
 *
 * An injected fault changes what the app does on purpose, so effects are compared only up to it.
 * In the step it fires in, the page is not compared, and the backend only for the provider calls
 * before a faulted call (nothing at all after a faulted webhook, whose place among the calls is
 * unknown). Steps after it are not compared. Each comparison is noted on the step, saying what was
 * left out.
 */
import { setTimeout as sleep } from "node:timers/promises"

import type { BackendActivity, BackendEvent } from "../browser/readiness.ts"
import type { Tabs } from "../browser/tabs.ts"
import type { EffectsEvent } from "../record/steps.ts"
import {
  backendEffect,
  backendMismatch,
  type Effects,
  pageDescriptions,
  pageEffect,
  pageMismatch,
} from "../replay/effects.ts"
import { viewPage } from "../snapshot/view.ts"

/** How long a replay waits for a recorded effect that has not shown yet. */
const SETTLE_MS = 3_000
const POLL_MS = 150

/** Where a step's effects are read from, for the whole session. */
export interface EffectSources {
  readonly tabs: Tabs
  readonly redact: (text: string) => string
  /** The backend's history so far; without it only page effects are compared. */
  readonly activity?: () => BackendActivity
  /** Leave out text matching any of these, as configured. */
  readonly ignore: readonly RegExp[]
}

/** How far each of the backend's histories had grown at some moment. */
export interface BackendMark {
  readonly calls: number
  readonly deliveries: number
}

const NOTHING: BackendActivity = { calls: [], deliveries: [] }

/** Where the backend's history stands now. */
export function markOf(activity: (() => BackendActivity) | undefined): BackendMark {
  const now = activity?.() ?? NOTHING

  return { calls: now.calls.length, deliveries: now.deliveries.length }
}

/** What a comparison came to, as the step's record notes it. */
export type EffectCheck = Omit<EffectsEvent, "kind" | "at">

/** The backend's history between two marks (to now when `to` is not given). */
function between(now: BackendActivity, from: BackendMark, to?: BackendMark): BackendActivity {
  return {
    calls: now.calls.slice(from.calls, to?.calls),
    deliveries: now.deliveries.slice(from.deliveries, to?.deliveries),
  }
}

function firstFault(activity: BackendActivity): BackendEvent | undefined {
  return [...activity.calls, ...activity.deliveries].find((event) => event.fault !== null)
}

/** The fault behind one event, named as the matrix names it. */
function faultName(event: BackendEvent): string {
  return `${event.fault ?? ""} on ${event.signature}`
}

function signatures(activity: BackendActivity): string[] {
  return [...activity.calls, ...activity.deliveries].map((event) => event.signature)
}

/** One step's watch: its start, and how its end compares. */
export class EffectWatch {
  private readonly sources: EffectSources
  private readonly before: readonly string[]
  private readonly mark: BackendMark
  /** The fault that fired earlier in the session, if one did. */
  private readonly earlierFault: BackendEvent | undefined

  private constructor(
    sources: EffectSources,
    start: { before: readonly string[]; mark: BackendMark; session: BackendMark },
  ) {
    this.sources = sources
    this.before = start.before
    this.mark = start.mark
    this.earlierFault = firstFault(between(this.now(), start.session, start.mark))
  }

  /** Starts watching a step: the page as it is now, and where the backend's history stands. */
  static async start(sources: EffectSources, session: BackendMark): Promise<EffectWatch> {
    const before = await EffectWatch.page(sources)

    return new EffectWatch(sources, { before, mark: markOf(sources.activity), session })
  }

  private static async page(sources: EffectSources): Promise<string[]> {
    return pageDescriptions((await viewPage(sources.tabs.page, sources.redact)).tree)
  }

  private now(): BackendActivity {
    return this.sources.activity?.() ?? NOTHING
  }

  /** What the step changed, for its recording; `values` are what may not be recorded. */
  async effects(values: readonly string[]): Promise<Effects> {
    const after = await EffectWatch.page(this.sources)

    return {
      page: pageEffect(this.before, after, { values, ignore: this.sources.ignore }),
      backend: backendEffect(signatures(between(this.now(), this.mark))),
    }
  }

  /**
   * How the step's effects compare with `expected`. A missing effect is waited for a little, as
   * a webhook may land just after the page settled.
   */
  async compare(expected: Effects): Promise<EffectCheck> {
    if (this.earlierFault !== undefined)
      return {
        result: "skipped",
        expected,
        note: `not compared: after the injected fault (${faultName(this.earlierFault)})`,
      }

    const deadline = Date.now() + SETTLE_MS
    let check = await this.once(expected)

    while (check.result === "diverged" && check.note === undefined && Date.now() < deadline) {
      await sleep(POLL_MS)
      check = await this.once(expected)
    }

    return check
  }

  private async once(expected: Effects): Promise<EffectCheck> {
    const step = between(this.now(), this.mark)
    const fault = firstFault(step)

    return fault === undefined ? this.whole(expected, step) : this.upTo(expected, step, fault)
  }

  /** The step ran without a fault: page and backend both as recorded. */
  private async whole(expected: Effects, step: BackendActivity): Promise<EffectCheck> {
    const now = await EffectWatch.page(this.sources)
    const observed: Effects = {
      page: pageEffect(this.before, now, { values: [], ignore: this.sources.ignore }),
      backend: backendEffect(signatures(step)),
    }
    const reason =
      backendMismatch(expected.backend, observed.backend) ?? pageMismatch(expected.page, now)

    return reason === undefined
      ? { result: "matched", expected, observed }
      : { result: "diverged", expected, observed, reason }
  }

  /** A fault fired in the step: only the calls before a faulted call, all of them recorded ones. */
  private upTo(expected: Effects, step: BackendActivity, fault: BackendEvent): EffectCheck {
    const at = step.calls.indexOf(fault)
    const before = at < 0 ? [] : backendEffect(step.calls.slice(0, at).map((e) => e.signature))
    const known = new Set(expected.backend)
    const extra = before.filter((signature) => !known.has(signature))
    const note =
      at < 0
        ? `not compared: the injected fault (${faultName(fault)}) fired in this step`
        : `compared up to the injected fault (${faultName(fault)}); the page and later calls were not`
    const observed: Effects = { page: { appeared: [], vanished: [] }, backend: before }

    return extra.length === 0
      ? { result: at < 0 ? "skipped" : "partial", expected, observed, note }
      : {
          result: "diverged",
          expected,
          observed,
          note,
          reason: `did not expect ${extra.join(", ")}`,
        }
  }
}
