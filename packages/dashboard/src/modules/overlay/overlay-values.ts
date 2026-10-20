/**
 * What the run overlay reads out of a flight record: the steps as a numbered transcript with the
 * moment each starts, the warnings worth pinning, the console by level, the network table, and the
 * prompt that hands a failure to a coding agent.
 */
import type { FailureVerdict } from "@danwo/runner/runner"
import { fixAdvice, VERDICT_LABELS } from "@danwo/runner/verdict"

import type { RecordView, StepView } from "../record/record-data.ts"
import { isPopup, type Replay, type ReplayTabMark } from "../record/record-replay.ts"
import { CACHE_WORDS, divergenceLine } from "../record/record-values.ts"

type Record_ = RecordView["record"]

/** One step of the transcript: the step as the record page has it, and where the player shows it. */
export interface TranscriptStep extends Omit<StepView, "cache"> {
  /** Where the step starts on the player's clock, when the run can be replayed. */
  readonly atMs?: number
  /** Which of the record's videos shows the step: the tab it ran in, in its person's browser. */
  readonly video?: number
  /** It ran in a popup or a tab the app opened, not the app's first tab. */
  readonly popup?: boolean
  /** What the replay cache did for an agent step, as its tag words it. */
  readonly cache?: string
}

/**
 * Where each step starts on the player's clock, and in which video: the one of the tab it ran in,
 * from the replay's marks (the timeline's, when the run kept no video).
 */
function stepStarts(replay: Replay): Map<number, { atMs: number; video?: number }> {
  const starts = new Map<number, { atMs: number; video?: number }>()
  const marked = [
    ...replay.videos.flatMap((video, at) =>
      video.marks.flatMap((mark) =>
        mark.step !== undefined && replay.stepVideos[mark.step] === at ? [{ mark, video: at }] : [],
      ),
    ),
    ...replay.marks.map((mark) => ({ mark, video: undefined })),
  ]

  for (const { mark, video } of marked)
    if (mark.kind === "step" && mark.step !== undefined && !starts.has(mark.step))
      starts.set(mark.step, {
        atMs: mark.atMs,
        ...(video !== undefined && { video }),
      })

  return starts
}

/** The steps in order, each with the moment the player jumps to for it. */
export function transcriptOf(view: Pick<RecordView, "steps">, replay: Replay): TranscriptStep[] {
  const starts = stepStarts(replay)

  return view.steps.map((step) => {
    const start = starts.get(step.index)

    return {
      ...step,
      ...(start !== undefined && { atMs: start.atMs }),
      ...(start?.video !== undefined && { video: start.video }),
      ...(isPopup(replay.videos, start?.video) && { popup: true }),
      ...(step.cache !== undefined && {
        cache: CACHE_WORDS[step.cache] ?? step.cache,
      }),
    }
  })
}

/**
 * Where the run moved between tabs just before step `at`: a popup that opened, or the run coming
 * back from one, since the step before it started.
 */
export function tabMovesBefore(
  steps: readonly Pick<TranscriptStep, "atMs">[],
  at: number,
  marks: readonly ReplayTabMark[],
): ReplayTabMark[] {
  const startMs = steps[at]?.atMs

  if (startMs === undefined) return []

  const after = at === 0 ? Number.NEGATIVE_INFINITY : (steps[at - 1]?.atMs ?? startMs)

  return marks.filter((mark) => mark.atMs > after && mark.atMs <= startMs)
}

/** Whether a step ran after the body: the wait for background work, or the invariant's checks. */
export function afterBody(step: Pick<TranscriptStep, "phase">): boolean {
  return step.phase === "settle" || step.phase === "checks"
}

/** A value check's sides in words: what it got, and what it wanted when it failed. */
export function checkWords(step: Pick<TranscriptStep, "check" | "status">): string | undefined {
  const { actual, expected } = step.check ?? {}

  if (actual === undefined) return undefined
  if (step.status === "passed" || expected === undefined) return `got ${actual}`

  return `expected ${expected}, got ${actual}`
}

/** A warning pinned under the transcript. */
export interface Warning {
  readonly kind: "error" | "fault" | "lint" | "note"
  readonly text: string
}

/** What went wrong or was injected in the run: its error, faults, lint findings and notes. */
export function warningsOf(record: Record_): Warning[] {
  const faults = [
    ...record.exchanges.flatMap((call) =>
      call.fault ? [`${call.fault} on ${call.method} ${call.host}${call.path}`] : [],
    ),
    ...record.deliveries.flatMap((d) => (d.fault ? [`${d.fault} on webhook ${d.topic}`] : [])),
  ]

  const diverged = divergenceLine(record)
  const all: Warning[] = [
    ...(record.error ? [{ kind: "error" as const, text: record.error.message }] : []),
    ...(record.stopped ? [{ kind: "error" as const, text: record.stopped }] : []),
    ...(diverged ? [{ kind: "note" as const, text: diverged }] : []),
    ...faults.map((text) => ({ kind: "fault" as const, text })),
    ...(record.lint ?? []).map((finding) => ({
      kind: "lint" as const,
      text: `${finding.rule}: ${finding.message}`,
    })),
    ...record.notes.map((text) => ({ kind: "note" as const, text })),
  ]

  // A note often repeats where the body stopped; each line is pinned once.
  return all.filter(
    (warning, i) =>
      all.findIndex(
        (other) => other.text.includes(warning.text) || warning.text.includes(other.text),
      ) === i,
  )
}

/** The console's level tabs, as a browser's devtools has them. */
export const CONSOLE_LEVELS = ["all", "error", "warn", "info", "log", "debug"] as const

export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number]

export const LEVEL_WORDS: Readonly<Record<ConsoleLevel, string>> = {
  all: "All",
  error: "Error",
  warn: "Warning",
  info: "Info",
  log: "Log",
  debug: "Debug",
}

type LogLine = Record_["appLog"][number]

/** A log line's tab: console output at info level is a plain log, navigation and the rest info. */
function levelOf(line: LogLine): Exclude<ConsoleLevel, "all"> {
  if (line.level === "info") return line.source === "console" ? "log" : "info"

  return line.level
}

/** The console lines under a level tab that hold every word typed in the filter. */
export function consoleLines(
  logs: readonly LogLine[],
  level: ConsoleLevel,
  filter: string,
): LogLine[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)

  return logs.filter(
    (line) =>
      (level === "all" || levelOf(line) === level) &&
      words.every((word) => line.text.toLowerCase().includes(word)),
  )
}

/** One row of the network table. */
export interface NetworkRow {
  readonly id: string
  /** Milliseconds from the run's start. */
  readonly atMs: number
  readonly name: string
  readonly status: string
  readonly method: string
  readonly type: string
  readonly initiator: string
  readonly durationMs: number | null
  readonly url: string
  readonly fault: string | null
  /** Scripts, styles, images and fonts, hidden unless asked for. */
  readonly asset: boolean
}

const ASSET_PATH = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)(\?|$)/i
const ASSET_TYPE = /^(text\/css|image\/|font\/|(application|text)\/javascript)/i

/** A content type in a word: `json` for `application/json; charset=utf-8`. */
function shortType(type: string | undefined): string {
  if (type === undefined || type === "") return "–"

  return (type.split(";")[0] ?? "").split("/").at(-1)?.replace(/^x-/, "") ?? "–"
}

/** Every call through the proxy as a network table row, oldest first. */
export function networkRows(record: Record_): NetworkRow[] {
  const origin = Date.parse(record.startedAt)

  return record.exchanges
    .map((call) => {
      const type = call.response?.headers["content-type"]
      const url = `${call.host}${call.path}`

      return {
        id: call.id,
        atMs: Math.max(0, Date.parse(call.startedAt) - origin),
        name: call.path.split("?")[0]?.split("/").filter(Boolean).at(-1) ?? call.host,
        status: call.aborted ? "aborted" : call.status === null ? "–" : String(call.status),
        method: call.method,
        type: shortType(type),
        initiator: call.origin ?? call.client ?? "–",
        durationMs: call.durationMs,
        url,
        fault: call.fault,
        asset: ASSET_PATH.test(call.path) || ASSET_TYPE.test(type ?? ""),
      }
    })
    .toSorted((a, b) => a.atMs - b.atMs)
}

/** The rows shown: assets only when asked for, and those holding the filter's words. */
export function shownRows(
  rows: readonly NetworkRow[],
  filter: string,
  assets: boolean,
): NetworkRow[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)

  return rows.filter(
    (row) =>
      (assets || !row.asset) &&
      words.every((word) => `${row.method} ${row.status} ${row.url}`.toLowerCase().includes(word)),
  )
}

/** When the run a record folder belongs to started, read from its `<date>-<time>` name. */
export function runStartOf(dir: string): string | undefined {
  const found = /(?:^|[\\/])(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]+(?:[\\/]|$)/.exec(
    dir,
  )

  if (found === null) return undefined

  const [, year, month, day, hour, minute, second] = found

  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
}

/** The failure page wrapped as a request to a coding agent: what to fix, then the evidence. */
export function fixPrompt(test: string, page: string, verdict?: FailureVerdict): string {
  return [
    `The danwo test "${test}" failed. Its failure page follows: the error, the step it stopped at, the provider calls and webhooks behind it, and the faults injected.`,
    verdict === undefined
      ? "Find the cause. Change the app when the record shows a bug, and the test only when the app's behaviour changed on purpose."
      : `danwo's verdict: ${VERDICT_LABELS[verdict.verdict]} (${verdict.confidence}), because ${verdict.reason}. ${fixAdvice(verdict)}`,
    "Then run the test again with `danwo test`.",
    "",
    page,
  ].join("\n")
}
