/** How the flight record page words and colours what a run did. */
import type { RecordedExchange } from "@danwo/runner/runner"

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

export function divergenceLine(record: RecordView["record"]): string | undefined {
  const { divergence } = record

  return divergence
    ? `The replay diverged at agent step ${divergence.step + 1} (${divergence.instruction}): ${divergence.reason}`
    : undefined
}

/** One side of a recorded call, as the call detail shows it. */
type CapturedMessage = NonNullable<RecordedExchange["request"]>

type FormPart = NonNullable<CapturedMessage["form"]>[number]

/** One multipart part as the call detail lists it: a field's value, or a file's name, type and size. */
function partLine(part: FormPart): string {
  if (!("file" in part)) return `${part.name}: ${part.value}`

  return `${part.name}: file "${part.file}" (${part.type || "no type"}, ${part.bytes} bytes)`
}

/**
 * A captured body as the call detail shows it: a multipart body's parts one to a line, a text
 * body as it came, or the size of one that is not text; marked when the capture cut it short.
 */
export function bodyText(message: CapturedMessage): string {
  const text = message.form
    ? message.form.map(partLine).join("\n") || "(an empty form)"
    : (message.body ?? `(${message.bytes} bytes, not text)`)

  return message.truncated ? `${text}\n… cut short` : text
}
