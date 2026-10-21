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
/**
 * How long it waits for a recorded provider call that has not happened yet. A call made by
 * background work (a queued job sending a notification) comes seconds after the step that caused
 * it, and a replay's actions run much faster than the model that recorded them.
 */
const BACKEND_SETTLE_MS = 10_000
const POLL_MS = 150
/** How long a recording waits for the backend to stay still before it reads the step's calls. */
const STILL_MS = 600
/** The longest it waits for that, for a backend that never stops (a poll, a heartbeat). */
const STILL_CAP_MS = 3_000

/** Where a step's effects are read from, for the whole session. */
export type EffectSources = EffectCommon &
  (
    | { readonly tabs: Tabs }
    /** A screen that is not a page (a device's), as a view's lines. */
    | { readonly tree: () => Promise<string> }
  )

interface EffectCommon {
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

/** Whether a recorded provider call has not happened (yet) in what `check` observed. */
function lacksCalls(expected: Effects, check: EffectCheck): boolean {
  const seen = new Set(check.observed?.backend ?? [])

  return expected.backend.some((signature) => !seen.has(signature))
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
    const tree =
      "tree" in sources
        ? await sources.tree()
        : (await viewPage(sources.tabs.page, sources.redact)).tree

    return pageDescriptions(tree)
  }

  private now(): BackendActivity {
    return this.sources.activity?.() ?? NOTHING
  }

  /**
   * What the step changed, for its recording; `values` are what may not be recorded. The provider
   * calls are read once the backend has gone still, so a call the step set off that lands just
   * after it (an email sent once the model's answer was saved) is kept: a replay, whose actions
   * run faster, would otherwise see it within the step and take it for one it should not make.
   */
  async effects(values: readonly string[]): Promise<Effects> {
    await this.backendStill()

    const after = await EffectWatch.page(this.sources)

    return {
      page: pageEffect(this.before, after, { values, ignore: this.sources.ignore }),
      backend: backendEffect(signatures(between(this.now(), this.mark))),
    }
  }

  /** Resolves once the backend's history has not grown for `STILL_MS`, or after `STILL_CAP_MS`. */
  private async backendStill(): Promise<void> {
    if (this.sources.activity === undefined) return

    const started = Date.now()
    let last = markOf(this.sources.activity)
    let since = started

    while (Date.now() - started < STILL_CAP_MS) {
      await sleep(POLL_MS)

      const now = markOf(this.sources.activity)

      if (now.calls !== last.calls || now.deliveries !== last.deliveries) {
        last = now
        since = Date.now()
      } else if (Date.now() - since >= STILL_MS) return
    }
  }

  /**
   * How the step's effects compare with `expected`. A missing effect is waited for a little, as
   * a webhook may land just after the page settled, and a missing provider call a little longer.
   */
  async compare(expected: Effects): Promise<EffectCheck> {
    if (this.earlierFault !== undefined)
      return {
        result: "skipped",
        expected,
        note: `not compared: after the injected fault (${faultName(this.earlierFault)})`,
      }

    const started = Date.now()
    let check = await this.once(expected)

    while (check.result === "diverged" && check.note === undefined) {
      const patience = lacksCalls(expected, check) ? BACKEND_SETTLE_MS : SETTLE_MS

      if (Date.now() - started >= patience) break
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
