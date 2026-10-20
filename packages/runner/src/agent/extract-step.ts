/**
 * One `agent.extract` step: read the result from where a recording says it is, or have the model
 * find it. Under strict replay there is no model: a field whose element is gone is a divergence,
 * and a step with no recording fails.
 */
import type { LanguageModel } from "ai"
import type { z } from "zod"

import type { Tabs } from "../browser/tabs.ts"
import type { CallCost } from "../model/resolve.ts"
import type { CacheNote, CacheOutcome } from "../record/steps.ts"
import type { Params } from "../replay/params.ts"
import type { TargetFinder } from "../replay/replayer.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import { describe, findAll, findTarget, type Target } from "../replay/target.ts"
import type { ExtractTrace } from "../replay/trace.ts"
import {
  type ExtractContext,
  ExtractFailed,
  extractLive,
  type FieldSource,
  readFields,
  sourceLabels,
} from "./extract.ts"
import { divergedNote, handedOff, missError, missOf } from "./miss.ts"

/** A recorded element that is not back within this long is gone: the page changed. */
const FIND_MS = 5_000

export interface ExtractStepContext {
  readonly tabs: Tabs
  readonly store: ReplayStore | undefined
  readonly strict: boolean
  readonly timeout: number
  readonly redact: (text: string) => string
  readonly signal?: AbortSignal | undefined
  /** The actor model, resolved; throws when the session has none. */
  readonly model: () => Exclude<LanguageModel, string>
  /** Finds a recorded target on the active tab; exact by default. */
  readonly find?: TargetFinder
  readonly onModelCall: (cost: CallCost) => void
  /** The step's vision, when values may be read off a screenshot. */
  readonly vision?: ExtractContext["vision"]
  readonly onAction: (label: string) => void
  /** A recorded element was found somewhere else. */
  readonly onRelocated: (from: Target, to: Target) => void
  readonly cache: (outcome: CacheOutcome, detail?: Omit<CacheNote, "mode">) => void
  /** Ends the session's replay here; later steps do nothing. */
  readonly diverge: (reason: string) => string
}

/** Reads the result where `trace` says it is; throws with the reason when it no longer can. */
async function replayExtract<T>(
  trace: ExtractTrace,
  schema: z.ZodType<T>,
  context: ExtractStepContext,
): Promise<{ value: T; trace: ExtractTrace }> {
  const timeout = Math.min(context.timeout, FIND_MS)
  const find: TargetFinder =
    context.find ??
    (async (target: Target, wait: number) => ({
      element: await findTarget(context.tabs.page, target, wait),
      target,
    }))
  const fields = []
  const found: ExtractTrace["fields"] = []

  for (const field of trace.fields) {
    if (field.as === "count") {
      const element = await findAll(context.tabs.page, field.target, timeout)

      fields.push({ path: field.path, as: field.as, element })
      found.push(field)
      continue
    }

    const located = await find(field.target, timeout)

    if (!(await located.element.isVisible()))
      throw new Error(`${describe(located.target)} is no longer shown`)
    if (located.target !== field.target) context.onRelocated(field.target, located.target)
    fields.push({ path: field.path, as: field.as, element: located.element })
    found.push({ ...field, target: located.target })
  }

  const value = await readFields(fields, schema)

  for (const label of sourceLabels(found)) context.onAction(label)

  return { value, trace: { ...trace, fields: found } }
}

/** The recording under `key` read again, or why it could not be. */
async function fromRecording<T>(
  key: StepKey | undefined,
  schema: z.ZodType<T>,
  context: ExtractStepContext,
): Promise<{ value: T; moved: ExtractTrace | undefined } | { reason: string | undefined }> {
  const trace = key === undefined ? undefined : await context.store?.readExtract(key.key)

  if (trace === undefined) return { reason: undefined }

  try {
    const read = await replayExtract(trace, schema, context)
    const moved = read.trace.fields.some((field, at) => field.target !== trace.fields[at]?.target)

    return { value: read.value, moved: moved ? read.trace : undefined }
  } catch (error) {
    return { reason: context.redact(error instanceof Error ? error.message : String(error)) }
  }
}

/** Runs one extract step. */
export async function extractStep<T>(
  step: { readonly index: number; readonly instruction: string; readonly params: Params },
  schema: z.ZodType<T>,
  context: ExtractStepContext,
): Promise<T> {
  const { instruction } = step
  const { store } = context
  const key = store?.key({ kind: "extract", step: step.index, instruction, params: step.params })
  const recorded = await fromRecording(key, schema, context)

  if ("value" in recorded) {
    if (recorded.moved !== undefined && key !== undefined)
      await store?.writeExtract(key, recorded.moved)
    context.cache(recorded.moved === undefined ? "replayed" : "relocated")

    return recorded.value
  }

  const miss: CacheNote =
    recorded.reason === undefined
      ? await missOf(store, key)
      : handedOff({ reason: recorded.reason }, context.redact)

  if (context.strict) return stopStrict(step, recorded.reason, miss, context)

  const live = await extractLive(instruction, schema, {
    model: context.model(),
    tabs: context.tabs,
    redact: context.redact,
    signal: context.signal,
    onModelCall: context.onModelCall,
    vision: context.vision,
  })

  await keep(key, instruction, live.sources, context)
  context.cache(miss.mode, { ...miss, saved: saves(store, live.sources) })

  return live.value
}

/** Under strict replay a step with nothing to replay fails, and one that no longer replays diverges. */
function stopStrict(
  step: { readonly index: number; readonly instruction: string },
  reason: string | undefined,
  miss: CacheNote,
  context: ExtractStepContext,
): never {
  if (reason === undefined) {
    context.cache(miss.mode, miss)
    throw missError(step.index, step.instruction, miss)
  }

  context.cache("diverged", divergedNote(miss))
  throw new ExtractFailed(step.instruction, `diverged: ${context.diverge(reason)}`)
}

/** Whether the model's sources become the step's recording. */
function saves(store: ReplayStore | undefined, sources: readonly FieldSource[] | null): boolean {
  return store !== undefined && store.writes && sources !== null && sources.length > 0
}

async function keep(
  key: StepKey | undefined,
  instruction: string,
  sources: readonly FieldSource[] | null,
  context: ExtractStepContext,
): Promise<void> {
  if (key === undefined || sources === null || sources.length === 0) return

  await context.store?.writeExtract(key, {
    version: 1,
    kind: "extract",
    instruction,
    recordedAt: new Date().toISOString(),
    fields: [...sources],
  })
}
