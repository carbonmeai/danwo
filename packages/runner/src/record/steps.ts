/**
 * The steps of one attempt as the flight recorder keeps them: every locator action, check, page
 * open and agent step, with the test line that called it, how long it took, how it ended, and
 * what happened inside it (model calls, the agent's actions, replay outcome). Labels and errors are
 * redacted as they are recorded.
 */
import { randomUUID } from "node:crypto"

import type { ScreenshotEvent } from "../assert/screenshot.ts"
import type { StepLog } from "../locate/locator.ts"
import type { Effects } from "../replay/effects.ts"
import { classOf, codeOf } from "../support/codes.ts"
import { callerLine, type SourceLine } from "./source.ts"

export type StepKind = "locator" | "assertion" | "app" | "agent"

/** How a finished step ended. */
export type StepVerdict = "passed" | "failed" | "blocked" | "inconclusive"

/** The verdict a step that threw `error` ends with, by the error's class. */
function verdictOf(error: unknown): StepVerdict {
  const kind = classOf(codeOf(error))

  return kind === "blocked" || kind === "inconclusive" ? kind : "failed"
}

/** Something that happened inside a step. */
export type StepEvent =
  | {
      readonly kind: "model"
      readonly at: string
      readonly inputTokens: number
      readonly outputTokens: number
      readonly cachedInputTokens?: number
      readonly costUsd?: number
      /** Asked again because the model's previous answer could not be used. */
      readonly retry?: boolean
    }
  | { readonly kind: "action"; readonly at: string; readonly label: string }
  /** How long the step waited after an action for the page, and the backend, to go quiet. */
  | {
      readonly kind: "ready"
      readonly at: string
      readonly ms: number
      readonly waited: "page" | "page+backend"
    }
  /** The app failed while the step ran: an error response, an uncaught error, a console error. */
  | { readonly kind: "app-error"; readonly at: string; readonly text: string }
  | ScreenshotEvent
  /** A recorded element was found somewhere else: where it was, and where it is now. */
  | { readonly kind: "relocated"; readonly at: string; readonly from: string; readonly to: string }
  | EffectsEvent

/**
 * How a replayed step's effects compared with its recording's: what was expected and what was
 * observed, why they differ when they do, and what was left out (a step after an injected fault).
 */
export interface EffectsEvent {
  readonly kind: "effects"
  readonly at: string
  /** `matched`, `diverged`, `partial` (compared up to an injected fault) or `skipped`. */
  readonly result: "matched" | "diverged" | "partial" | "skipped"
  readonly expected?: Effects
  readonly observed?: Effects
  readonly reason?: string
  /** What was not compared, and why. */
  readonly note?: string
}

/**
 * How an agent step used the replay cache, one of a fixed set:
 *
 * - `off`: the session has no cache;
 * - `replayed`: the recording replayed as recorded, with no model;
 * - `relocated`: the recording replayed, with an element found somewhere other than recorded;
 * - `handed-off`: the replay started, stopped matching, and the model took the step over;
 * - `missed`: there was no recording, so the model ran (or, under strict replay, the step failed);
 * - `stale`: a recording of this step exists under another key (see `changed`), so it was not used;
 * - `diverged`: under strict replay the recording no longer replays; this and later steps did nothing.
 */
export type CacheOutcome =
  | "off"
  | "replayed"
  | "relocated"
  | "handed-off"
  | "missed"
  | "stale"
  | "diverged"

/** Every cache outcome, in the order summaries list them. */
export const CACHE_OUTCOMES: readonly CacheOutcome[] = [
  "replayed",
  "relocated",
  "handed-off",
  "missed",
  "stale",
  "diverged",
  "off",
]

/** What a step's cache use came to: its outcome, whether a new recording was kept, and why stale. */
export interface CacheNote {
  readonly mode: CacheOutcome
  /** A new recording of the step was staged (written once a later check confirms it). */
  readonly saved?: boolean
  /** For `stale`: which parts of the step's key differ from the recording's. */
  readonly changed?: readonly string[]
  /**
   * For `diverged` and `handed-off`: `effect` when every action replayed but the step did not have
   * its recorded effect on the page or the backend (see replay/effects.ts).
   */
  readonly because?: "effect"
}

export interface StepRecord {
  readonly id: string
  readonly index: number
  readonly kind: StepKind
  /** The API that ran, e.g. `locator.click` or `agent.act`. */
  readonly api: string
  /** The call as written, e.g. `getByRole("button", name: "Save").click()`. */
  readonly label: string
  /**
   * How the step ended: `blocked` when it could not be judged (the page was not where it could be
   * checked), `inconclusive` when the judge could not tell; other failures are `failed`.
   */
  readonly status: "running" | StepVerdict
  readonly startedAt: string
  readonly durationMs: number
  /** The test file line that called the step, relative to the project root. */
  readonly source?: SourceLine
  readonly error?: { readonly code: string; readonly message: string }
  readonly events: readonly StepEvent[]
  readonly cache?: CacheNote
}

/** One line the app wrote to its console, an uncaught page error, or a navigation. */
export interface AppLogRecord {
  readonly at: string
  readonly level: "debug" | "info" | "warn" | "error"
  readonly source: "console" | "page-error" | "navigation" | "device-log"
  readonly text: string
  /** The step that was running (or last ran) when it was logged. */
  readonly step: number
}

interface Running {
  record: StepRecord
  readonly events: StepEvent[]
}

export interface StepRecorderOptions {
  readonly projectRoot: string
  readonly redact: (text: string) => string
  /** Called when a step starts, with its status `running`. */
  readonly onStart?: (step: StepRecord) => void
  /** Called when a step ends, passed or failed. */
  readonly onEnd?: (step: StepRecord) => void
}

/** Records the steps of one attempt in the order they started. */
export class StepRecorder implements StepLog {
  private readonly steps: Running[] = []
  private readonly log: AppLogRecord[] = []
  /** Indexes of checks that passed and verify what came before them. */
  private readonly verified: number[] = []
  private readonly options: StepRecorderOptions

  constructor(options: StepRecorderOptions) {
    this.options = options
  }

  /** Runs `body` as a step; a failure is recorded with its error and rethrown. */
  async run<T>(
    kind: StepKind,
    api: string,
    label: string,
    body: () => Promise<T>,
    options: { readonly verifies?: boolean } = {},
  ): Promise<T> {
    const source = callerLine(this.options.projectRoot)
    const running: Running = {
      record: {
        id: randomUUID(),
        index: this.steps.length,
        kind,
        api,
        label: this.options.redact(label),
        status: "running",
        startedAt: new Date().toISOString(),
        durationMs: 0,
        ...(source && { source }),
        events: [],
      },
      events: [],
    }
    const started = Date.now()

    this.steps.push(running)
    this.options.onStart?.(running.record)

    try {
      const result = await body()

      this.finish(running, started, { status: "passed" }, options.verifies === true)

      return result
    } catch (error) {
      this.finish(running, started, { status: verdictOf(error), error: this.errorOf(error) }, false)
      throw error
    }
  }

  /** Adds an event to the step running now (the latest one started). */
  event(event: StepEvent): void {
    const running = this.steps.at(-1)

    if (running === undefined) return
    running.events.push(
      event.kind === "action" ? { ...event, label: this.options.redact(event.label) } : event,
    )
  }

  /** Notes how the running agent step used the replay cache. */
  cache(mode: CacheOutcome, detail: Omit<CacheNote, "mode"> = {}): void {
    const running = this.steps.at(-1)

    if (running !== undefined) running.record = { ...running.record, cache: { mode, ...detail } }
  }

  /** The index the next step will get, which is also the index of a step about to run. */
  get next(): number {
    return this.steps.length
  }

  /** Whether a check that verifies passed after step `index`, confirming what it did. */
  verifiedAfter(index: number): boolean {
    return this.verified.some((verified) => verified > index)
  }

  /** Every step so far, with its events. */
  all(): readonly StepRecord[] {
    return this.steps.map(({ record, events }) => ({ ...record, events: [...events] }))
  }

  /** Records a line of the app's log against the step running or last run. */
  appLog(entry: Omit<AppLogRecord, "step" | "text"> & { readonly text: string }): void {
    this.log.push({
      ...entry,
      text: this.options.redact(entry.text),
      step: Math.max(0, this.steps.length - 1),
    })
  }

  /** The app's log so far. */
  appLogs(): readonly AppLogRecord[] {
    return [...this.log]
  }

  private finish(
    running: Running,
    started: number,
    outcome: Pick<StepRecord, "status" | "error">,
    verifies: boolean,
  ): void {
    running.record = { ...running.record, ...outcome, durationMs: Date.now() - started }
    if (verifies) this.verified.push(running.record.index)
    this.options.onEnd?.({ ...running.record, events: [...running.events] })
  }

  private errorOf(error: unknown): NonNullable<StepRecord["error"]> {
    const message = error instanceof Error ? error.message : String(error)

    return { code: codeOf(error), message: this.options.redact(message) }
  }
}
