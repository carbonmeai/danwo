/**
 * `agent.act` and `agent.assert` for one session. An act step first looks for a recording of
 * itself: one that replays to the same end needs no model. Under strict replay a recording that no
 * longer replays stops the session's agent there (the divergence is kept and later steps do
 * nothing), and a step with no recording fails, since a run that replays nothing tests nothing.
 * Otherwise the model carries the step out, and a successful run becomes the new recording once a
 * later check confirms it.
 */
import { resolve } from "node:path"

import type { LanguageModel } from "ai"
import type { z } from "zod"

import type { AppErrors, FailureMark } from "../browser/app-errors.ts"
import type { Tabs } from "../browser/tabs.ts"
import type { MailDesk } from "../mail/desk.ts"
import { type CallCost, resolveModel } from "../model/resolve.ts"
import type { StepRecorder } from "../record/index.ts"
import type { CacheNote } from "../record/steps.ts"
import type { Params } from "../replay/params.ts"
import { type RelocationPolicy, relocates } from "../replay/policy.ts"
import { findOrRelocate } from "../replay/relocate.ts"
import {
  replay,
  ReplayMismatch,
  type ReplayOutcome,
  type TargetFinder,
} from "../replay/replayer.ts"
import { routeOf } from "../replay/route.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import { describe } from "../replay/target.ts"
import type { Trace } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import { DanwoError } from "../support/codes.ts"
import { type Budget, type Budgets, DEFAULT_STEP_BUDGET, Spend, Spends } from "./budget.ts"
import { AgentStepFailed } from "./errors.ts"
import { extractStep } from "./extract-step.ts"
import { ExtractFailed } from "./extract.ts"
import type { Files } from "./files.ts"
import { judge, type JudgeContext, type Poll } from "./judge.ts"
import { type LiveResult, runLive } from "./live.ts"
import { missError, missOf } from "./miss.ts"
import { JUDGE_PROMPT, WAIT_PROMPT } from "./prompts.ts"
import type {
  ActOptions,
  ActResult,
  Agent,
  AssertOptions,
  ExtractOptions,
  PollOption,
  WaitForOptions,
} from "./types.ts"
import { waitStep } from "./wait.ts"

/** The current time, as step and log lines record it. */
function now(): string {
  return new Date().toISOString()
}

/** How long `agent.waitFor` waits by default, and how often the judge looks meanwhile. */
const DEFAULT_WAIT_MS = 30_000
const DEFAULT_INTERVAL_MS = 1_000

/** The polling an assert asked for: none, the session's defaults, or its own numbers. */
function pollOf(option: PollOption | undefined, defaults: Poll): Poll | undefined {
  if (option === undefined || option === false) return undefined
  if (option === true) return defaults

  return {
    timeout: option.timeout ?? defaults.timeout,
    interval: option.interval ?? defaults.interval,
  }
}

/** Where a strict replay stopped following its recording. */
export interface ReplayDivergence {
  /** Zero-based index of the agent step (`act` or `extract`) that diverged. */
  readonly step: number
  readonly instruction: string
  /** Why the recording no longer replays. */
  readonly reason: string
}

export interface AgentOptions {
  readonly tabs: Tabs
  readonly appUrl: string
  /** Files every step may upload, by name, as absolute paths. */
  readonly files: Files
  /** Where an `act` call's own file paths resolve from. */
  readonly projectRoot: string
  readonly steps: StepRecorder
  readonly vault: SecretVault
  readonly store: ReplayStore | undefined
  /** Replay only; stop at the first step whose recording no longer replays. */
  readonly strict: boolean
  /** How a replay finds recorded elements; strict replay always matches exactly. */
  readonly relocation: RelocationPolicy
  readonly model: LanguageModel | undefined
  readonly judge: LanguageModel | undefined
  readonly context?: string | undefined
  /** Show the judge a screenshot besides the page's text. */
  readonly judgeScreenshot?: boolean
  readonly actionTimeout: number
  /** How long `agent.assert(..., { poll: true })` keeps asking. */
  readonly assertionTimeout: number
  /** Limits per agent step and over the whole session (one test attempt). */
  readonly budgets?: Budgets
  /** A step's conversation size, in characters, before older page views are dropped. */
  readonly transcriptBudget?: number
  readonly signal?: AbortSignal | undefined
  /** Waits, after an action, for the page and the backend to go quiet (see readiness.ts). */
  readonly ready: () => Promise<void>
  /** The app's failures while steps run; a step the app failed in is not kept. */
  readonly appErrors?: AppErrors
  /** Mail the app sent: codes and links a step reads, recorded by where they came from. */
  readonly mail: MailDesk
}

/** One `act` call: which step it is, what it says, and what it may use and spend. */
interface ActCall {
  readonly index: number
  readonly instruction: string
  readonly params: Params
  readonly files: Files
  readonly budget: Budget | undefined
}

class SessionAgent implements Agent {
  private readonly options: AgentOptions
  private divergence: ReplayDivergence | undefined
  private actCount = 0
  /** What every agent step of the session spent together, against the test's budget. */
  private readonly spent: Spend

  constructor(options: AgentOptions) {
    this.options = options
    this.spent = new Spend(options.budgets?.test ?? {}, "test")
  }

  diverged(): ReplayDivergence | undefined {
    return this.divergence
  }

  act(instruction: string, options: ActOptions = {}): Promise<ActResult> {
    const index = this.actCount++
    const label = this.options.vault.redact(instruction)
    const call: ActCall = {
      index,
      instruction,
      params: options.params ?? {},
      files: this.filesOf(options),
      budget: options.budget,
    }

    return this.options.steps.run("agent", "agent.act", label, () => this.step(call))
  }

  /** A model call outside an `act` step's loop: recorded, and counted against the test's budget. */
  private noteCall(cost: CallCost): void {
    this.spent.call(cost)
    this.options.steps.event({ kind: "model", at: now(), ...cost })
  }

  /** The session's files with the step's own, which resolve against the project root. */
  private filesOf(options: ActOptions): Files {
    const own = Object.entries(options.files ?? {}).map(([name, path]) => [
      name,
      resolve(this.options.projectRoot, path),
    ])

    return { ...this.options.files, ...Object.fromEntries(own) }
  }

  extract<T>(instruction: string, schema: z.ZodType<T>, options: ExtractOptions = {}): Promise<T> {
    const index = this.actCount++
    const { steps, vault } = this.options

    return steps.run("agent", "agent.extract", vault.redact(instruction), () => {
      this.spent.check()

      if (this.divergence !== undefined) {
        steps.cache("diverged")
        throw new ExtractFailed(
          instruction,
          `not run: the replay diverged at step ${this.divergence.step}`,
        )
      }

      return extractStep({ index, instruction, params: options.params ?? {} }, schema, {
        tabs: this.options.tabs,
        store: this.options.store,
        strict: this.options.strict,
        timeout: this.options.actionTimeout,
        ...this.finder(),
        redact: vault.redact,
        signal: this.options.signal,
        model: () => this.requireModel(this.options.model),
        onModelCall: (cost) => this.noteCall(cost),
        onAction: (label) => steps.event({ kind: "action", at: now(), label }),
        onRelocated: (from, to) =>
          steps.event({ kind: "relocated", at: now(), from: describe(from), to: describe(to) }),
        cache: (outcome, detail) => steps.cache(outcome, detail),
        diverge: (reason) => {
          this.divergence = { step: index, instruction, reason: vault.redact(reason) }

          return this.divergence.reason
        },
      })
    })
  }

  assert(claim: string, options: AssertOptions = {}): Promise<void> {
    const { steps } = this.options
    const poll = pollOf(options.poll, {
      timeout: this.options.assertionTimeout,
      interval: DEFAULT_INTERVAL_MS,
    })

    return steps.run(
      "agent",
      "agent.assert",
      this.options.vault.redact(claim),
      () => {
        this.spent.check()

        return judge(claim, this.judgeContext(JUDGE_PROMPT), poll)
      },
      { verifies: true },
    )
  }

  waitFor(condition: string, options: WaitForOptions = {}): Promise<void> {
    const index = this.actCount++
    const { steps, vault } = this.options
    const poll: Poll = {
      timeout: options.timeout ?? DEFAULT_WAIT_MS,
      interval: options.interval ?? DEFAULT_INTERVAL_MS,
    }

    const body = async () => {
      this.spent.check()

      if (this.divergence !== undefined) {
        steps.cache("diverged")

        return
      }

      await waitStep(
        { index, condition, params: options.params ?? {} },
        {
          tabs: this.options.tabs,
          store: this.options.store,
          strict: this.options.strict,
          poll,
          judge: () => this.judgeContext(WAIT_PROMPT),
          redact: vault.redact,
          volatile: () => this.options.mail.values(),
          cache: (outcome, detail) => steps.cache(outcome, detail),
          diverge: (reason) => {
            this.divergence = { step: index, instruction: condition, reason: vault.redact(reason) }

            return this.divergence.reason
          },
        },
      )
    }

    return steps.run("agent", "agent.waitFor", vault.redact(condition), body, { verifies: true })
  }

  /** The judge as a step calls it, told its job by `system`. */
  private judgeContext(system: string): JudgeContext {
    return {
      model: this.requireModel(this.options.judge ?? this.options.model),
      system,
      tabs: this.options.tabs,
      redact: this.options.vault.redact,
      vocabulary: this.options.context,
      screenshot: this.options.judgeScreenshot ?? false,
      signal: this.options.signal,
      onModelCall: (cost) => this.noteCall(cost),
    }
  }

  /**
   * The app's failures since `mark`, noted on the step. Outside strict replay the first one fails
   * the step; under strict replay the state the app was left in is the invariant's to judge.
   */
  private checkApp(mark: FailureMark | undefined): void {
    const failed = this.noteApp(mark)

    if (failed !== undefined && !this.options.strict) throw failed
  }

  /** Notes the app's failures since `mark` on the step; how it failed, if it did. */
  private noteApp(mark: FailureMark | undefined): Error | undefined {
    const { appErrors, steps } = this.options

    if (appErrors === undefined || mark === undefined) return undefined

    for (const failure of appErrors.failures(mark))
      steps.event({ kind: "app-error", at: now(), text: this.options.vault.redact(failure.text) })

    return appErrors.since(mark)
  }

  private async step(call: ActCall): Promise<ActResult> {
    const { index, instruction, params, files } = call
    const { steps, store } = this.options

    if (this.divergence !== undefined) return this.skipped(this.divergence)

    const mark = this.options.appErrors?.mark()
    const key = store?.key({ kind: "act", step: index, instruction, params })
    const replayed = await this.replayRecording(key, params, files)

    if (replayed.ok) {
      steps.cache(replayed.relocated ? "relocated" : "replayed")
      this.checkApp(mark)

      return { summary: "replayed the recording", modelCalls: 0, actions: replayed.actions }
    }

    const miss: CacheNote =
      replayed.reason === undefined ? await missOf(store, key) : { mode: "handed-off" }

    if (this.options.strict) return this.stopStrict(index, instruction, replayed.reason, miss)

    const result = await this.runModel(call, mark).catch((error: unknown) => {
      this.noteApp(mark)
      throw error
    })

    this.checkApp(mark)
    this.keep(key, instruction, result, miss)

    return {
      summary: result.summary,
      modelCalls: result.modelCalls,
      actions: result.recorded?.length ?? 0,
    }
  }

  /** A step after a strict replay diverged does nothing. */
  private skipped(divergence: ReplayDivergence): ActResult {
    this.options.steps.cache("diverged")

    return {
      summary: `not run: the replay diverged at step ${divergence.step}`,
      modelCalls: 0,
      actions: 0,
    }
  }

  /** Replays the recording under `key`; `reason` is undefined when there is none. */
  private async replayRecording(
    key: StepKey | undefined,
    params: Params,
    files: Files,
  ): Promise<
    { ok: true; actions: number; relocated: boolean } | { ok: false; reason: string | undefined }
  > {
    const trace = key === undefined ? undefined : await this.options.store?.read(key.key)

    if (trace === undefined || key === undefined) return { ok: false, reason: undefined }

    const outcome = await this.tryReplay(trace, params, files)

    if (typeof outcome === "string") return { ok: false, reason: outcome }

    this.noteMoves(key, outcome)

    return { ok: true, actions: trace.actions.length, relocated: outcome.moved.length > 0 }
  }

  /** Records where moved elements were found, and keeps the recording pointing at them. */
  private noteMoves(key: StepKey, outcome: ReplayOutcome): void {
    const { steps, store } = this.options

    for (const move of outcome.moved)
      steps.event({
        kind: "relocated",
        at: new Date().toISOString(),
        from: describe(move.from),
        to: describe(move.to),
      })

    if (outcome.moved.length > 0) store?.stage(key, steps.next - 1, outcome.trace)
  }

  /** How the replay went; otherwise why it did not. */
  private async tryReplay(
    trace: Trace,
    params: Params,
    files: Files,
  ): Promise<ReplayOutcome | string> {
    try {
      return await replay(trace, {
        ...this.finder(),
        tabs: this.options.tabs,
        appUrl: this.options.appUrl,
        vault: this.options.vault,
        params,
        files,
        timeout: this.options.actionTimeout,
        ready: this.options.ready,
        mail: this.options.mail,
        onAction: (label) =>
          this.options.steps.event({ kind: "action", at: new Date().toISOString(), label }),
      })
    } catch (error) {
      if (error instanceof ReplayMismatch) return error.message

      throw error
    }
  }

  /** Relocation, when the session's policy looks for moved elements: never under strict replay. */
  private finder(): { find?: TargetFinder } {
    if (this.options.strict || !relocates(this.options.relocation)) return {}

    return {
      find: (target, timeout) => findOrRelocate(this.options.tabs.page, target, timeout),
    }
  }

  private stopStrict(
    index: number,
    instruction: string,
    reason: string | undefined,
    miss: CacheNote,
  ): ActResult {
    if (reason === undefined) {
      this.options.steps.cache(miss.mode, miss)
      throw missError(index, instruction, miss)
    }

    this.divergence = { step: index, instruction, reason: this.options.vault.redact(reason) }
    this.options.steps.cache("diverged")

    return { summary: `diverged: ${this.divergence.reason}`, modelCalls: 0, actions: 0 }
  }

  private async runModel(call: ActCall, mark: FailureMark | undefined): Promise<LiveResult> {
    const { steps, vault, budgets, appErrors } = this.options
    const { instruction } = call
    const own = new Spend(
      { ...DEFAULT_STEP_BUDGET, ...budgets?.step, ...call.budget },
      `step "${vault.redact(instruction)}"`,
    )
    const result = await runLive(instruction, {
      model: this.requireModel(this.options.model),
      tabs: this.options.tabs,
      appUrl: this.options.appUrl,
      vault,
      params: call.params,
      files: call.files,
      timeout: this.options.actionTimeout,
      context: this.options.context,
      signal: this.options.signal,
      spends: new Spends(own, this.spent),
      transcriptBudget: this.options.transcriptBudget,
      ready: this.options.ready,
      mail: this.options.mail,
      ...(appErrors !== undefined &&
        mark !== undefined && { appFailure: () => appErrors.since(mark) }),
      onModelCall: (cost) => steps.event({ kind: "model", at: now(), ...cost }),
      onAction: (label) => steps.event({ kind: "action", at: now(), label }),
    })

    if (result.status === "failed")
      throw new AgentStepFailed(
        `agent.act(${JSON.stringify(instruction)}) failed: ${this.options.vault.redact(result.summary)}`,
      )

    return result
  }

  /** Stages the step's actions as its recording, written once a later check confirms them. */
  private keep(
    key: StepKey | undefined,
    instruction: string,
    result: LiveResult,
    miss: CacheNote,
  ): void {
    const { store, steps } = this.options

    if (store === undefined || key === undefined || result.recorded === null || !store.writes) {
      steps.cache(miss.mode, { ...miss, saved: false })

      return
    }

    store.stage(key, steps.next - 1, {
      version: 1,
      instruction,
      recordedAt: new Date().toISOString(),
      actions: [...result.recorded],
      endRoute: routeOf(this.options.tabs.page.url(), new URL(this.options.appUrl).origin),
    })
    steps.cache(miss.mode, { ...miss, saved: true })
  }

  private requireModel(model: LanguageModel | undefined) {
    if (model === undefined)
      throw new DanwoError(
        "CONFIG_INVALID",
        "this session has no model: pass `model` to use agent.act and agent.assert",
      )

    return resolveModel(model)
  }
}

/** The agent of one session, with the divergence of a strict replay. */
export function createAgent(
  options: AgentOptions,
): Agent & { diverged(): ReplayDivergence | undefined } {
  return new SessionAgent(options)
}
