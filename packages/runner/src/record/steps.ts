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

/**
 * What a step was: a locator action, a locator or page check, an app call (`app.open`, time
 * travel), an agent step, a `check` of a plain value (an invariant's `expect(count).toBe(1)`), or
 * the `settle` wait for background work before the invariant ran.
 */
export type StepKind = "locator" | "assertion" | "app" | "agent" | "check" | "settle"

/**
 * Which part of the attempt a step ran in: the `setup` hooks, the test's `body`, the `settle` wait
 * for background work, the invariant's `checks`, or the `teardown` hooks.
 */
export type AttemptPhase = "setup" | "body" | "settle" | "checks" | "teardown"

/** A value check's two sides, previewed and redacted: what it got, and what it wanted. */
export interface CheckValues {
  readonly actual?: string
  readonly expected?: string
}

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
  /**
   * The page was too long for the model's view, which kept its first `kept` characters of
   * `chars`; noted the first time it happens in a step.
   */
  | {
      readonly kind: "view-cut"
      readonly at: string
      readonly chars: number
      readonly kept: number
    }
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

/**
 * What became of a step's new recording: `staged` while the attempt runs, then `kept` once a later
 * check confirmed it, or not kept because the test failed after it (`test-failed`) or no check
 * passed after it (`unchecked`).
 */
export type RecordingFate = "staged" | "kept" | "test-failed" | "unchecked"

/** How each fate reads in a report, after the step's cache outcome. */
const RECORDING_WORDS: Readonly<Record<RecordingFate, string>> = {
  staged: "recorded, kept only if the test passes",
  kept: "recorded",
  "test-failed": "not kept: the test failed",
  unchecked: "not kept: no check after it passed",
}

/** What became of a step's new recording, in words; undefined when it made none. */
export function recordingText(note: Pick<CacheNote, "saved" | "recording">): string | undefined {
  if (note.recording !== undefined) return RECORDING_WORDS[note.recording]

  return note.saved === true ? RECORDING_WORDS.kept : undefined
}

/** What a step's cache use came to: its outcome, whether a new recording was kept, and why stale. */
export interface CacheNote {
  readonly mode: CacheOutcome
  /** A new recording of the step was written to the cache. */
  readonly saved?: boolean
  /** For a recording that waits for a later check: what became of it. */
  readonly recording?: RecordingFate
  /** For `stale`: which parts of the step's key differ from the recording's. */
  readonly changed?: readonly string[]
  /**
   * For `diverged` and `handed-off`: `effect` when every action replayed but the step did not have
   * its recorded effect on the page or the backend (see replay/effects.ts).
   */
  readonly because?: "effect"
  /** For `diverged` and `handed-off`: what stopped matching, in a line, with secrets redacted. */
  readonly reason?: string
  /** For a replay of a recording another model made: that model, as `openai/gpt-5-mini`. */
  readonly recordedWith?: string
  /** With `recordedWith`: the model the session runs on, which the replay did not call. */
  readonly runningWith?: string
}

/** `recorded with openai/gpt-5-mini, running anthropic/claude-sonnet-5`, for another model's recording. */
export function modelText(
  note: Pick<CacheNote, "recordedWith" | "runningWith">,
): string | undefined {
  if (note.recordedWith === undefined || note.runningWith === undefined) return undefined

  return `recorded with ${note.recordedWith}, running ${note.runningWith}`
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
  /** The person whose browser the step ran in, when the test opened more than one person's. */
  readonly user?: string
  /**
   * The tab it ran in, counting from 1 in the order the tabs opened, as the videos are numbered
   * (`video/tab-<n>.webm`); absent for a step with no browser, and in older records.
   */
  readonly tab?: number
  /** The part of the attempt it ran in; absent in records made before phases were kept. */
  readonly phase?: AttemptPhase
  /** For a `check` step: the value it looked at and the value it wanted. */
  readonly check?: CheckValues
  /** For a `settle` step: the background work it waited for, one line each. */
  readonly waitedOn?: readonly string[]
}

/** One line the app wrote to its console, an uncaught page error, or a navigation. */
export interface AppLogRecord {
  readonly at: string
  readonly level: "debug" | "info" | "warn" | "error"
  readonly source: "console" | "page-error" | "navigation" | "device-log"
  readonly text: string
  /** The step that was running (or last ran) when it was logged. */
  readonly step: number
  /** The person whose browser logged it, when the test opened more than one person's. */
  readonly user?: string
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

/** What every person's recorder of one attempt writes to: one list of steps, one app log. */
interface Shared {
  readonly steps: Running[]
  readonly log: AppLogRecord[]
  /** Indexes of checks that passed and verify what came before them. */
  readonly verified: number[]
  /** The part of the attempt running now, stamped on every step that starts. */
  phase: AttemptPhase
}

/**
 * Records the steps of one attempt in the order they started. A test that opens more people's
 * browsers records each person's steps through `forUser`, into the same list.
 */
export class StepRecorder implements StepLog {
  private readonly steps: Running[]
  private readonly log: AppLogRecord[]
  private readonly verified: number[]
  private readonly shared: Shared
  private readonly options: StepRecorderOptions
  private readonly user: string | undefined
  /** The tab this person's steps run in, read when each starts. */
  private tab: (() => number | undefined) | undefined

  constructor(
    options: StepRecorderOptions,
    shared: Shared = { steps: [], log: [], verified: [], phase: "body" },
    user?: string,
  ) {
    this.options = options
    this.steps = shared.steps
    this.log = shared.log
    this.verified = shared.verified
    this.shared = shared
    this.user = user
  }

  /** A recorder of `user`'s steps, written to this attempt's list and tagged with their name. */
  forUser(user: string): StepRecorder {
    return new StepRecorder(this.options, this.shared, user)
  }

  /** Stamps every later step of this recorder's person with the tab `tab` names when it starts. */
  followTabs(tab: () => number | undefined): void {
    this.tab = tab
  }

  /**
   * Sets the tab of this person's running step to where it found its element: a step that started
   * as a popup was opening runs in the popup, though the app's tab was active when it began.
   */
  ranIn(tab: number): void {
    const running = this.latest()

    if (running?.record.status === "running" && running.record.tab !== tab)
      running.record = { ...running.record, tab }
  }

  /** Marks the part of the attempt that starts now; every person's later steps are stamped with it. */
  enter(phase: AttemptPhase): void {
    this.shared.phase = phase
  }

  /** The latest step of this recorder's person: events and cache notes belong to it. */
  private latest(): Running | undefined {
    return this.steps.findLast((running) => running.record.user === this.user)
  }

  /** Runs `body` as a step; a failure is recorded with its error and rethrown. */
  async run<T>(
    kind: StepKind,
    api: string,
    label: string,
    body: () => Promise<T>,
    options: { readonly verifies?: boolean } = {},
  ): Promise<T> {
    const running = this.begin(kind, api, label)
    const started = Date.now()

    try {
      const result = await body()

      this.finish(running, started, { status: "passed" }, options.verifies === true)

      return result
    } catch (error) {
      this.finish(running, started, { status: verdictOf(error), error: this.errorOf(error) }, false)
      throw error
    }
  }

  /**
   * Records a check of a plain value: `body` runs the matcher, synchronously or as a promise
   * (`resolves`, `rejects`), and the step keeps both sides. A failed check is rethrown as it was.
   */
  check<T>(api: string, label: string, values: CheckValues, body: () => T): T {
    const running = this.begin("check", api, label)
    const started = Date.now()

    const failed = (error: unknown): never => {
      running.record = { ...running.record, check: this.valuesOf(values, error) }
      this.finish(running, started, { status: "failed", error: this.errorOf(error) }, false)
      throw error
    }

    const passed = <V>(value: V): V => {
      running.record = { ...running.record, check: this.valuesOf(values) }
      this.finish(running, started, { status: "passed" }, false)

      return value
    }

    try {
      const result = body()

      if (!isThenable(result)) return passed(result)

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a promise in is a promise out: the same value, settled
      return Promise.resolve(result).then(passed, failed) as T
    } catch (error) {
      return failed(error)
    }
  }

  /** Records the wait for background work, with what it waited on, as a `settle` step. */
  async settle(wait: () => Promise<readonly string[]>): Promise<void> {
    const running = this.begin("settle", "settle", "waiting for background work")
    const started = Date.now()

    try {
      const waitedOn = (await wait()).map((line) => this.options.redact(line))

      running.record = { ...running.record, waitedOn }
      this.finish(running, started, { status: "passed" }, false)
    } catch (error) {
      this.finish(running, started, { status: verdictOf(error), error: this.errorOf(error) }, false)
      throw error
    }
  }

  /** Starts a step of `kind`, stamped with the phase, the caller's line and the person. */
  private begin(kind: StepKind, api: string, label: string): Running {
    const source = callerLine(this.options.projectRoot)
    /* A value check or the settle wait runs in no tab: the browser only waits through them. */
    const tab = kind === "check" || kind === "settle" ? undefined : this.tab?.()
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
        ...(this.user !== undefined && { user: this.user }),
        ...(tab !== undefined && { tab }),
        phase: this.shared.phase,
      },
      events: [],
    }

    this.steps.push(running)
    this.options.onStart?.(running.record)

    return running
  }

  /** Adds an event to the step running now (the latest one started). */
  event(event: StepEvent): void {
    const running = this.latest()

    if (running === undefined) return
    running.events.push(
      event.kind === "action" ? { ...event, label: this.options.redact(event.label) } : event,
    )
  }

  /** Notes how the running agent step used the replay cache. */
  cache(mode: CacheOutcome, detail: Omit<CacheNote, "mode"> = {}): void {
    const running = this.latest()

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

  /**
   * Notes what became of each staged recording once the attempt ended: kept when `confirmed`,
   * otherwise dropped because a later step failed, or because no check after it passed.
   */
  settleRecordings(confirmed: (index: number) => boolean): void {
    for (const running of this.steps) {
      const { cache, index } = running.record

      if (cache?.recording !== "staged") continue

      const failedLater = this.steps.some(
        (later) => later.record.index > index && later.record.status !== "passed",
      )
      const recording: RecordingFate = confirmed(index)
        ? "kept"
        : failedLater
          ? "test-failed"
          : "unchecked"

      running.record = {
        ...running.record,
        cache: { ...cache, saved: recording === "kept", recording },
      }
    }
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
      ...(this.user !== undefined && { user: this.user }),
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

  /** `value` as one short line, redacted before it is cut. */
  preview(value: unknown): string {
    return preview(value, this.options.redact)
  }

  /** A check's sides, redacted; a failed matcher's own actual and expected win where it has them. */
  private valuesOf(values: CheckValues, error?: unknown): CheckValues {
    const fromError = (key: "actual" | "expected"): string | undefined =>
      typeof error === "object" && error !== null && key in error
        ? preview(Reflect.get(error, key), this.options.redact)
        : undefined
    const actual = fromError("actual") ?? values.actual
    const expected = fromError("expected") ?? values.expected

    return {
      ...(actual !== undefined && { actual: this.options.redact(actual) }),
      ...(expected !== undefined && { expected: this.options.redact(expected) }),
    }
  }

  private errorOf(error: unknown): NonNullable<StepRecord["error"]> {
    const message = error instanceof Error ? error.message : String(error)

    return { code: codeOf(error), message: this.options.redact(message) }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof Reflect.get(value, "then") === "function"
  )
}

/** How long a previewed value may be in a step. */
const PREVIEW_CHARS = 160

/** A value as one line: a string quoted, anything else as JSON where it can be. */
function asText(value: unknown): string {
  if (typeof value === "function") return value.name === "" ? "function" : `${value.name}()`
  if (typeof value === "object" && value !== null) return objectText(value)

  return primitiveText(value)
}

/** A primitive as written in code: a string quoted, a bigint with its `n`. */
function primitiveText(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "symbol") return value.toString()

  if (typeof value === "number") return String(value)

  return JSON.stringify(value) ?? "undefined"
}

/** An object as JSON, a promise by name, and one JSON cannot hold by its tag. */
function objectText(value: object): string {
  if (isThenable(value)) return "promise"

  try {
    return JSON.stringify(value) ?? "{}"
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * A value as one short line for a step's label or sides, cut to length. `redact` runs before the
 * cut, so a cut through a secret leaves none of it behind.
 */
export function preview(value: unknown, redact: (text: string) => string = (text) => text): string {
  const text = redact(asText(value))

  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text
}
