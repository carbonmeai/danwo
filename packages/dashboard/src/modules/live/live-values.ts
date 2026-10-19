/**
 * A live run as the dashboard shows it, folded from its feed's events: the attempts running and
 * done, each with its steps, calls and webhooks, the tests and trials that finished, and what the
 * run has spent. The same fold runs on the server for a first paint and in the browser as events
 * stream in.
 */
import type {
  LiveCall,
  LiveDelivery,
  LiveEvent,
  LiveRunStarted,
  LiveStep,
} from "@danwo/runner/runner"

/** One attempt of a test, or one matrix trial, as it runs. */
export interface LiveAttempt {
  readonly key: string
  readonly test: string
  /** `attempt-1`, or the trial's fault (`clean` for the clean run). */
  readonly attempt: string
  readonly startedAt: string
  /** `running` until it ends. */
  readonly status: string
  readonly durationMs: number | undefined
  /** By index; a step that started and ended appears once, as it ended. */
  readonly steps: readonly LiveStep[]
  readonly calls: readonly LiveCall[]
  readonly deliveries: readonly LiveDelivery[]
}

/** Whether the run is still going, finished, or stopped without finishing (killed, crashed). */
export type LiveState = "running" | "finished" | "stopped"

export interface LiveView {
  readonly id: string
  readonly kind: LiveRunStarted["kind"]
  readonly title: string
  readonly startedAt: string
  readonly pid: number
  readonly planned: number
  readonly state: LiveState
  readonly exitCode: number | undefined
  readonly durationMs: number | undefined
  /** Newest first. */
  readonly attempts: readonly LiveAttempt[]
  /** Tests (for `danwo test`) or trials (for `danwo matrix`) that finished, in finishing order. */
  readonly done: readonly { readonly name: string; readonly status: string }[]
  readonly usd: number
  /** When the latest event was written. */
  readonly lastAt: string
}

type Draft = {
  -readonly [K in keyof LiveView]: LiveView[K]
} & { attemptsByKey: Map<string, LiveAttempt> }

const keyOf = (test: string, attempt: string) => `${test} ${attempt}`

function patch(draft: Draft, key: string, change: (attempt: LiveAttempt) => LiveAttempt): void {
  const attempt = draft.attemptsByKey.get(key)

  if (attempt !== undefined) draft.attemptsByKey.set(key, change(attempt))
}

function withStep(steps: readonly LiveStep[], step: LiveStep): LiveStep[] {
  const others = steps.filter((known) => known.index !== step.index)

  return [...others, step].toSorted((a, b) => a.index - b.index)
}

type Handler<T extends LiveEvent["type"]> = (
  draft: Draft,
  event: Extract<LiveEvent, { type: T }>,
) => void

const HANDLERS: { readonly [T in LiveEvent["type"]]: Handler<T> } = {
  run: () => undefined,
  attempt(draft, event) {
    const key = keyOf(event.test, event.attempt)

    draft.attemptsByKey.set(key, {
      key,
      test: event.test,
      attempt: event.attempt,
      startedAt: event.at,
      status: "running",
      durationMs: undefined,
      steps: [],
      calls: [],
      deliveries: [],
    })
  },
  step(draft, event) {
    patch(draft, keyOf(event.test, event.attempt), (a) => ({
      ...a,
      steps: withStep(a.steps, event.step),
    }))
    if (event.step.status !== "running") draft.usd += event.step.usd
  },
  call(draft, event) {
    patch(draft, keyOf(event.test, event.attempt), (a) => ({
      ...a,
      calls: [...a.calls, event.call],
    }))
  },
  delivery(draft, event) {
    patch(draft, keyOf(event.test, event.attempt), (a) => ({
      ...a,
      deliveries: [...a.deliveries, event.delivery],
    }))
  },
  "attempt-end"(draft, event) {
    patch(draft, keyOf(event.test, event.attempt), (a) => ({
      ...a,
      status: event.status,
      durationMs: event.durationMs,
    }))
  },
  test(draft, event) {
    draft.done = [...draft.done, { name: event.test, status: event.status }]
  },
  plan(draft, event) {
    draft.planned = event.planned
  },
  trial(draft, event) {
    draft.done = [...draft.done, { name: event.fault ?? "clean", status: event.status }]
  },
  end(draft, event) {
    draft.state = "finished"
    draft.exitCode = event.exitCode
    draft.durationMs = event.durationMs
  },
}

function apply(draft: Draft, event: LiveEvent): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each handler takes the event of its own type
  const handler = HANDLERS[event.type] as Handler<LiveEvent["type"]>

  handler(draft, event)
  if ("at" in event) draft.lastAt = event.at
}

/**
 * The run its events describe, or undefined before the first line arrived. `alive` says whether its
 * process is still there: a run that never wrote its last line and whose process is gone stopped.
 */
export function foldLive(events: readonly LiveEvent[], alive = true): LiveView | undefined {
  const [first] = events

  if (first?.type !== "run") return undefined

  const draft = draftOf(first)

  for (const event of events.slice(1)) apply(draft, event)

  const { attemptsByKey, ...view } = draft
  const state = view.state === "running" && !alive ? "stopped" : view.state

  return { ...view, state, attempts: [...attemptsByKey.values()].toReversed() }
}

/** A run before anything happened in it. */
function draftOf(first: LiveRunStarted): Draft {
  return {
    id: first.id,
    kind: first.kind,
    title: first.title,
    startedAt: first.at,
    pid: first.pid,
    planned: first.planned,
    state: "running",
    exitCode: undefined,
    durationMs: undefined,
    attempts: [],
    done: [],
    usd: 0,
    lastAt: first.at,
    attemptsByKey: new Map(),
  }
}

/** How many tests (or trials) finished, how many failed, and how many are still to come. */
export function progressOf(view: LiveView): { done: number; failed: number; left: number } {
  const failed = view.done.filter((item) => FAILING.has(item.status)).length

  return { done: view.done.length, failed, left: Math.max(0, view.planned - view.done.length) }
}

const FAILING = new Set(["failed", "timed-out", "interrupted", "environment-error"])

/** The attempts still running. */
export function runningAttempts(view: LiveView): LiveAttempt[] {
  return view.attempts.filter((attempt) => attempt.status === "running")
}

/** The run's state in a word, for its badge and the page title. */
export function stateWord(view: LiveView): string {
  if (view.state === "running") return "running"
  if (view.state === "stopped") return "stopped"

  return view.exitCode === 0 ? "passed" : "failed"
}

/** Parses a feed's text into its events, skipping a last line still being written. */
export function parseFeed(text: string): LiveEvent[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return []

    try {
      const event: LiveEvent = JSON.parse(line)

      return [event]
    } catch {
      return []
    }
  })
}
