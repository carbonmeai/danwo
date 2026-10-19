/**
 * A flight record on one clock: the test's steps, the calls the app made through the proxy and the
 * webhooks providers sent back, each placed by when it started and how long it took, so a
 * waterfall can show what the app did behind each step.
 */
import type { FlightRecord } from "@danwo/runner/runner"

/** One bar of the waterfall. */
export interface TimelineItem {
  readonly kind: "step" | "call" | "webhook"
  readonly label: string
  /** Milliseconds after the record's first event. */
  readonly startMs: number
  readonly durationMs: number
  /** `passed` / `failed` for steps; the HTTP status (or what happened instead) for calls and webhooks. */
  readonly outcome: string
  /** True when the outcome is a failure: a failed step, a 4xx/5xx, a refused or aborted call. */
  readonly bad: boolean
  readonly fault?: string
  /** The step this is (steps), or the step whose time it falls in (calls and webhooks). */
  readonly step?: number
}

export interface Timeline {
  readonly items: readonly TimelineItem[]
  readonly spanMs: number
}

type Delivery = FlightRecord["deliveries"][number]

/** The parts of a record the timeline reads. */
export interface TimedRecord {
  readonly startedAt: string
  readonly steps: readonly Pick<
    FlightRecord["steps"][number],
    "index" | "label" | "status" | "startedAt" | "durationMs"
  >[]
  readonly exchanges: readonly Pick<
    FlightRecord["exchanges"][number],
    "method" | "host" | "path" | "startedAt" | "durationMs" | "status" | "aborted" | "fault"
  >[]
  readonly deliveries: readonly Pick<
    Delivery,
    "sentAt" | "at" | "service" | "topic" | "attempt" | "durationMs" | "status" | "error" | "fault"
  >[]
}

function millis(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined

  const value = Date.parse(iso)

  return Number.isNaN(value) ? undefined : value
}

function statusBad(status: number | null): boolean {
  return status === null || status >= 400
}

/** The step running at `at`, if any. */
function stepAt(
  steps: readonly { index: number; start: number; end: number }[],
  at: number,
): number | undefined {
  return steps.find((step) => at >= step.start && at <= step.end)?.index
}

/** One row of the waterfall: a step, or every call or webhook with the same label under a step. */
export interface Lane {
  readonly kind: TimelineItem["kind"]
  readonly label: string
  readonly items: readonly TimelineItem[]
}

/**
 * The timeline as waterfall rows. Each step starts a row, and the calls and webhooks after it that
 * share a label share a row, so a page polling one endpoint reads as one row of ticks.
 */
export function lanesOf(items: readonly TimelineItem[]): Lane[] {
  const lanes: { kind: TimelineItem["kind"]; label: string; items: TimelineItem[] }[] = []
  let block = new Map<string, (typeof lanes)[number]>()

  for (const item of items) {
    if (item.kind === "step") {
      lanes.push({ kind: "step", label: item.label, items: [item] })
      block = new Map()
      continue
    }

    const key = `${item.kind} ${item.label}`
    const lane = block.get(key)

    if (lane) lane.items.push(item)
    else {
      const fresh = { kind: item.kind, label: item.label, items: [item] }

      block.set(key, fresh)
      lanes.push(fresh)
    }
  }

  return lanes
}

/** Every step, call and webhook of a record on one clock, in the order they started. */
export function timelineOf(record: TimedRecord): Timeline {
  const origin = millis(record.startedAt) ?? 0
  const spans = record.steps.map((step) => {
    const start = millis(step.startedAt) ?? origin

    return { index: step.index, start, end: start + step.durationMs }
  })
  const items: TimelineItem[] = [
    ...record.steps.map((step, i) => ({
      kind: "step" as const,
      label: step.label,
      startMs: (spans[i]?.start ?? origin) - origin,
      durationMs: step.durationMs,
      outcome: step.status,
      bad: step.status !== "passed",
      step: step.index,
    })),
    ...record.exchanges.map((exchange) => {
      const start = millis(exchange.startedAt) ?? origin
      const step = stepAt(spans, start)

      return {
        kind: "call" as const,
        label: `${exchange.method} ${exchange.host}${exchange.path.split("?")[0] ?? ""}`,
        startMs: start - origin,
        durationMs: exchange.durationMs ?? 0,
        outcome: exchange.aborted ? "aborted" : String(exchange.status ?? "no answer"),
        bad: exchange.aborted || statusBad(exchange.status),
        ...(exchange.fault ? { fault: exchange.fault } : {}),
        ...(step !== undefined && { step }),
      }
    }),
    ...record.deliveries.map((delivery) => {
      const start = millis(delivery.sentAt ?? delivery.at) ?? origin
      const step = stepAt(spans, start)

      return {
        kind: "webhook" as const,
        label: `${delivery.service ? `${delivery.service} ` : ""}${delivery.topic}${delivery.attempt > 1 ? ` (attempt ${delivery.attempt})` : ""}`,
        startMs: start - origin,
        durationMs: delivery.durationMs,
        outcome:
          delivery.status === null ? (delivery.error ?? "no answer") : String(delivery.status),
        bad: statusBad(delivery.status),
        ...(delivery.fault ? { fault: delivery.fault } : {}),
        ...(step !== undefined && { step }),
      }
    }),
  ].toSorted((a, b) => a.startMs - b.startMs)
  const spanMs = items.reduce((max, item) => Math.max(max, item.startMs + item.durationMs), 0)

  return { items, spanMs }
}
