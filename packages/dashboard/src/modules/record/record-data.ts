/**
 * One flight record as the attempt page shows it: the record danwo wrote (redacted when it was
 * written), each step's effects spelled out, the screen at failure and the Markdown failure page.
 * Screenshots load one at a time, as data URLs, so a long run's page stays light.
 */
import { readFile } from "node:fs/promises"
import { extname, join, relative } from "node:path"

import {
  effectNotes,
  effectsOf,
  failurePage,
  type FlightRecord,
  type RecordedStep,
  recordingText,
  redactCredentials,
} from "@danwo/runner/runner"

import { insideArea, isVersioned, readJson } from "../../lib/project-files.ts"
import { type EffectLine, effectDiff } from "./record-effects.ts"
import { type Replay, replayOf } from "./record-replay.ts"
import { type Timeline, timelineOf } from "./record-timeline.ts"

/** A step with what the page needs beside the record's own fields. */
export interface StepView {
  readonly index: number
  readonly kind: RecordedStep["kind"]
  readonly label: string
  readonly api: string
  readonly status: string
  readonly durationMs: number
  /** The person whose browser the step ran in, when the test opened more than one person's. */
  readonly user?: string
  readonly source?: string
  /** The part of the attempt it ran in: setup, body, settle, checks or teardown. */
  readonly phase?: RecordedStep["phase"]
  /** A value check's two sides, what it got and what it wanted. */
  readonly check?: RecordedStep["check"]
  /** What the settle wait waited for, one line each. */
  readonly waitedOn?: readonly string[]
  readonly error?: string
  readonly cache?: string
  readonly cacheDetail?: string
  readonly screenshot?: string
  /** Expected vs observed effects, as lines, when the step compared them. */
  readonly effects?: readonly string[]
  readonly effectResult?: string
  /** What the recording expected against what the replay did, line by line. */
  readonly effectDiff?: readonly EffectLine[]
}

/** Everything the attempt page renders. */
export interface RecordView {
  /** The record's folder, relative to the project root. */
  readonly dir: string
  /** The record without its emulator state, which `state` carries as text. */
  readonly record: Omit<FlightRecord, "state">
  /** The emulators' state when the run ended, as indented JSON. */
  readonly state: string
  readonly steps: readonly StepView[]
  /** Steps, calls and webhooks on one clock. */
  readonly timeline: Timeline
  /** What the replay player plays: the run's video, else its screenshots. */
  readonly replay: Replay
  readonly screen?: string
  /** The Markdown failure page, for failed records. */
  readonly page?: string
}

function isFlightRecord(value: unknown): value is FlightRecord {
  return isVersioned(value) && "steps" in value && Array.isArray(value.steps)
}

/** Why a step's cache outcome came out as it did, in a few words. */
function cacheDetail(step: RecordedStep): string | undefined {
  const note = step.cache

  if (note === undefined) return undefined
  if (note.changed?.length) return `changed: ${note.changed.join(", ")}`
  if (note.because === "effect") return "the recorded effect did not happen"

  return recordingText(note)
}

/** The step's phase, a check's sides and what settling waited for, where the record kept them. */
function phaseFields(step: RecordedStep): Pick<StepView, "phase" | "check" | "waitedOn"> {
  return {
    ...(step.phase !== undefined && { phase: step.phase }),
    ...(step.check !== undefined && { check: step.check }),
    ...(step.waitedOn !== undefined && { waitedOn: step.waitedOn }),
  }
}

function stepView(step: RecordedStep): StepView {
  const effects = effectsOf(step.events)
  const detail = cacheDetail(step)

  return {
    index: step.index,
    kind: step.kind,
    label: step.label,
    api: step.api,
    status: step.status,
    durationMs: step.durationMs,
    ...phaseFields(step),
    ...(step.user !== undefined && { user: step.user }),
    ...(step.source && { source: `${step.source.file}:${step.source.line}` }),
    ...(step.error && { error: `${step.error.code}: ${step.error.message}` }),
    ...(step.cache && { cache: step.cache.mode }),
    ...(detail !== undefined && { cacheDetail: detail }),
    ...(step.screenshot !== undefined && { screenshot: step.screenshot }),
    ...(effects && {
      effects: effectNotes(effects),
      effectResult: effects.result,
      effectDiff: effectDiff(effects),
    }),
  }
}

/** The record in `dir` (relative to the project root, under `.danwo/runs`). */
export async function getRecord(root: string, dir: string): Promise<RecordView | undefined> {
  const full = insideArea(root, "runs", dir)
  const record = await readJson(join(full, "record.json"))

  if (!isFlightRecord(record)) return undefined

  const screenFile = record.failure?.screen
  const screen =
    screenFile === undefined
      ? undefined
      : await readFile(insideArea(root, "runs", join(dir, screenFile)), "utf8").catch(
          () => undefined,
        )
  const failed = record.status !== "passed"
  const { state, ...rest } = record
  const shown = relative(root, full).split("\\").join("/")
  const timeline = timelineOf(record)

  return {
    dir: shown,
    record: rest,
    state: JSON.stringify(state, null, 2),
    steps: record.steps.map(stepView),
    timeline,
    replay: replayOf(shown, record, timeline),
    ...(screen !== undefined && { screen: redactCredentials(screen) }),
    ...(failed && { page: failurePage(record, screen) }),
  }
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
}

/**
 * A screenshot of a record as a data URL. Only images inside the run folders are served; the
 * recorder masks secret fields before it writes them.
 */
export async function getScreenshot(root: string, dir: string, file: string): Promise<string> {
  const type = IMAGE_TYPES[extname(file).toLowerCase()]

  if (type === undefined) throw new Error(`${file} is not a screenshot`)

  const bytes = await readFile(insideArea(root, "runs", join(dir, file)))

  return `data:${type};base64,${bytes.toString("base64")}`
}
