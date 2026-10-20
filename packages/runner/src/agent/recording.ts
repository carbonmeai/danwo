/**
 * What an agent step does with its recording, whatever it drives: compare a replay's effects with
 * the recording's, and stage a live run's actions as the new recording (written once a later
 * check confirms them). Shared by the browser's agent and the device's.
 */
import type { LanguageModel } from "ai"

import type { MailDesk } from "../mail/desk.ts"
import { type CallCost, resolveModel } from "../model/resolve.ts"
import type { StepRecorder } from "../record/index.ts"
import type { CacheNote } from "../record/steps.ts"
import { type Params, paramText } from "../replay/params.ts"
import type { ReplayMismatch } from "../replay/replayer.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import type { RecordedAction, Trace } from "../replay/trace.ts"
import { DanwoError } from "../support/codes.ts"
import { type Budget, type Budgets, DEFAULT_STEP_BUDGET, Spend, Spends } from "./budget.ts"
import type { EffectWatch } from "./effect-watch.ts"
import { AgentStepFailed } from "./errors.ts"
import type { Poll } from "./judge.ts"
import type { PollOption } from "./types.ts"

function now(): string {
  return new Date().toISOString()
}

/** The model a step runs on; a clear error when the session has none. */
export function requireModel(model: LanguageModel | undefined) {
  if (model === undefined)
    throw new DanwoError(
      "CONFIG_INVALID",
      "this session has no model: pass `model` to use agent.act and agent.assert",
    )

  return resolveModel(model)
}

/** A live step's result when it passed; a step that failed throws with the model's words. */
export function passed<Result extends { readonly status: string; readonly summary: string }>(
  result: Result,
  instruction: string,
  redact: (text: string) => string,
): Result {
  if (result.status === "failed")
    throw new AgentStepFailed(
      `agent.act(${JSON.stringify(instruction)}) failed: ${redact(result.summary)}`,
    )

  return result
}

/** Where a live step's model calls and actions go: the step's record. */
export function stepEvents(steps: StepRecorder) {
  return {
    onModelCall: (cost: CallCost) => steps.event({ kind: "model", at: now(), ...cost }),
    onAction: (label: string) => steps.event({ kind: "action", at: now(), label }),
  }
}

/** The polling an assert asked for: none, the session's defaults, or its own numbers. */
export function pollOf(option: PollOption | undefined, defaults: Poll): Poll | undefined {
  if (option === undefined || option === false) return undefined
  if (option === true) return defaults

  return {
    timeout: option.timeout ?? defaults.timeout,
    interval: option.interval ?? defaults.interval,
  }
}

/** A step's own spend (its budget over the session's defaults) with its test's. */
export function stepSpends(
  budgets: Budgets | undefined,
  own: Budget | undefined,
  what: string,
  test: Spend,
): Spends {
  return new Spends(new Spend({ ...DEFAULT_STEP_BUDGET, ...budgets?.step, ...own }, what), test)
}

/** Compares the replay's effects with the recording's and notes how; why they differ, if they do. */
export async function compareEffects(
  steps: StepRecorder,
  trace: Trace,
  watch: EffectWatch | undefined,
): Promise<string | undefined> {
  if (watch === undefined || trace.effects === undefined) return undefined

  const check = await watch.compare(trace.effects)

  steps.event({ kind: "effects", at: now(), ...check })

  return check.result === "diverged" ? check.reason : undefined
}

/**
 * The recorded actions a replay carried out before it stopped matching: every one before the
 * action that failed, or all of them when only the end route differed.
 */
export function ranBefore(trace: Trace, mismatch: ReplayMismatch): readonly RecordedAction[] {
  return trace.actions.slice(0, mismatch.action)
}

/** Values that differ from run to run, which an effect may not hold: params and mail values. */
function runValues(params: Params, mail: MailDesk): string[] {
  const named = Object.keys(params).flatMap((name) => paramText(params, name) ?? [])

  return [...named, ...mail.values()]
}

/** A live run of one step, to keep as its recording. */
export interface LiveRun {
  readonly store: ReplayStore | undefined
  readonly steps: StepRecorder
  readonly key: StepKey | undefined
  readonly instruction: string
  readonly params: Params
  readonly mail: MailDesk
  /** The run's actions; null when one cannot be replayed. */
  readonly recorded: readonly RecordedAction[] | null
  /**
   * What a replay that stopped matching had already done before the model took over: the model
   * went on from there, so the recording begins with them.
   */
  readonly replayed?: readonly RecordedAction[]
  readonly miss: CacheNote
  readonly watch: EffectWatch | undefined
  /** Where the step left the app, as the recording keeps it. */
  readonly endRoute: () => Promise<string> | string
}

/**
 * Stages the step's actions as its recording, written once a later check confirms them, with the
 * effects the step had when it was watched; notes on the step that it is staged, and the session
 * notes whether it was kept when it closes.
 */
export async function keepRecording(run: LiveRun): Promise<void> {
  const { store, steps, key, miss, watch, recorded } = run

  if (store === undefined || key === undefined || recorded === null || !store.writes) {
    steps.cache(miss.mode, { ...miss, saved: false })

    return
  }

  const effects = await watch?.effects(runValues(run.params, run.mail))

  store.stage(key, steps.next - 1, {
    version: 1,
    instruction: run.instruction,
    recordedAt: now(),
    actions: [...(run.replayed ?? []), ...recorded],
    endRoute: await run.endRoute(),
    ...(effects !== undefined && { effects }),
  })
  steps.cache(miss.mode, { ...miss, saved: false, recording: "staged" })
}
