/** How the flight record page words and colours what a run did. */
import type { RecordView } from "./record-data.ts"
import type { EffectLine } from "./record-effects.ts"
import type { TimelineItem } from "./record-timeline.ts"

/** The cache outcome, as the tag words it. */
export const CACHE_WORDS: Readonly<Record<string, string>> = {
  replayed: "replayed",
  relocated: "relocated",
  "handed-off": "handed off",
  missed: "model ran",
  stale: "stale",
  diverged: "diverged",
  off: "no cache",
}

export function cacheTone(mode: string): "hit" | "partial" | "miss" | "bad" {
  if (mode === "replayed") return "hit"
  if (mode === "relocated" || mode === "handed-off" || mode === "stale") return "partial"

  return mode === "diverged" ? "bad" : "miss"
}

/** How each line of an effects diff is marked, worded and coloured. */
export const SEEN: Readonly<
  Record<EffectLine["seen"], { mark: string; word: string; color: string }>
> = {
  both: { mark: " ", word: "as recorded", color: "ink.muted" },
  expected: { mark: "−", word: "missing", color: "verdict.failed.fg" },
  observed: { mark: "+", word: "new", color: "verdict.flaky.fg" },
}

/** The colour an HTTP status or outcome reads in. */
export function statusColor(item: Pick<TimelineItem, "outcome" | "bad">): string {
  const code = Number(item.outcome)

  if (!Number.isFinite(code)) return item.bad ? "verdict.failed.fg" : "ink.muted"
  if (code >= 500) return "verdict.failed.fg"
  if (code >= 400) return "verdict.flaky.fg"

  return code >= 300 ? "ink.muted" : "verdict.passed.fg"
}

export const LEVEL_COLOR: Readonly<Record<string, string>> = {
  error: "verdict.failed.fg",
  warn: "verdict.flaky.fg",
}

/** How the run is named in the title: its attempt, or the fault it ran under. */
export function runName(view: RecordView): string {
  const { run } = view.record

  if (run.kind === "test") return `attempt ${run.attempt}`

  return run.fault ? run.fault.label : "clean run"
}

export function divergenceLine(record: RecordView["record"]): string | undefined {
  const { divergence } = record

  return divergence
    ? `The replay diverged at agent step ${divergence.step + 1} (${divergence.instruction}): ${divergence.reason}`
    : undefined
}
