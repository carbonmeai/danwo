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
import type { BackendActivity } from "../browser/readiness.ts"
import type { Tabs } from "../browser/tabs.ts"
import type { MailDesk } from "../mail/desk.ts"
import type { CallCost } from "../model/resolve.ts"
import type { StepRecorder } from "../record/index.ts"
import type { CacheNote } from "../record/steps.ts"
import { type Params, uniqueValues } from "../replay/params.ts"
import { type RelocationPolicy, relocates } from "../replay/policy.ts"
import { findOrRelocate } from "../replay/relocate.ts"
import {
  replay,
  ReplayMismatch,
  type ReplayOutcome,
  type TargetFinder,
} from "../replay/replayer.ts"
import { routeOf, templateRoute } from "../replay/route.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import { describe } from "../replay/target.ts"
import type { RecordedAction, Trace } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import { DanwoError } from "../support/codes.ts"
import { type VisionChoice, VisionDesk, visionFor, type VisionMode } from "../vision/desk.ts"
import { SecretSpots } from "../vision/screen.ts"
import { type Budget, type Budgets, Spend } from "./budget.ts"
import { type BackendMark, EffectWatch, markOf } from "./effect-watch.ts"
import { ReplayMissing } from "./errors.ts"
import { extractStep } from "./extract-step.ts"
import { ExtractFailed } from "./extract.ts"
import type { Files } from "./files.ts"
import { ClaimFailed, type JudgeContext, type Poll, type Unheld } from "./judge.ts"
import { type LiveResult, runLive } from "./live.ts"
import { divergedNote, handedOff, missError, missOf, missWhy } from "./miss.ts"
import { JUDGE_PROMPT, WAIT_PROMPT } from "./prompts.ts"
import {
  compareEffects,
  keepRecording,
  type LiveRun,
  pollOf,
  requireModel,
  passed,
  ranBefore,
  stepEvents,
  stepSpends,
} from "./recording.ts"
import type {
  ActOptions,
  ActResult,
  Agent,
  AssertOptions,
  ExtractOptions,
  WaitForOptions,
} from "./types.ts"
import { type JudgedStep, notHeld, type WaitStepContext, waitStep } from "./wait.ts"

/** The current time, as step and log lines record it. */
function now(): string {
  return new Date().toISOString()
}

/** How long `agent.waitFor` waits by default, and how often the judge looks meanwhile. */
const DEFAULT_WAIT_MS = 30_000
const DEFAULT_INTERVAL_MS = 1_000

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
  /**
   * Replay only, and call no model at all: a step with no recording that replays fails with
   * `REPLAY_MISSING`, and the test goes on to fail as any failed step would.
   */
  readonly replayOnly?: boolean
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
  /** Whether replays must have their recordings' effects, and text to leave out of them. */
  readonly effects?: { readonly enabled: boolean; readonly ignore: readonly RegExp[] }
  /** The backend's history, which a step's backend effect is read from. */
  readonly activity?: () => BackendActivity
  /**
   * When steps may see the page as an image (default `auto`), and the model that places described
   * targets on a screenshot (default the agent's model).
   */
  readonly vision?: { readonly mode: VisionMode; readonly model?: LanguageModel | undefined }
  /** Moves time forward for the app, its services and the page (the session's `time`). */
  readonly travel?: (ms: number) => Promise<void>
}

/** One `act` call: which step it is, what it says, and what it may use and spend. */
interface ActCall {
  readonly index: number
  readonly instruction: string
  readonly params: Params
  readonly files: Files
  readonly budget: Budget | undefined
  /** Whether its replay must have its recording's effects. */
  readonly effects: boolean
  /** Whether it may see the page as an image. */
  readonly vision: VisionMode
  /** Whether it may move time forward. */
  readonly time: boolean
}

/**
 * How replaying a step's recording went: how many actions, or why it did not replay and the
 * actions it carried out before it stopped.
 */
type Replayed =
  | {
      readonly ok: true
      readonly actions: number
      readonly relocated: boolean
      /** The model that made the recording, when it says. */
      readonly recordedBy?: string | undefined
    }
  | {
      readonly ok: false
      readonly reason: string | undefined
      readonly effect?: boolean
      readonly ran?: readonly RecordedAction[]
    }

class SessionAgent implements Agent {
  private readonly options: AgentOptions
  private divergence: ReplayDivergence | undefined
  private actCount = 0
  /** What every agent step of the session spent together, against the test's budget. */
  private readonly spent: Spend
  /** Where the backend's history stood when the session began; earlier events are not its own. */
  private readonly sessionMark: BackendMark
  /** Fields secrets went into, painted over in every screenshot of the session. */
  private readonly spots = new SecretSpots()
  /** The session's looks at the page as an image, and its marks. */
  private readonly desk: VisionDesk

  constructor(options: AgentOptions) {
    this.options = options
    this.spent = new Spend(options.budgets?.test ?? {}, "test")
    this.sessionMark = markOf(options.activity)
    this.desk = new VisionDesk({
      spots: this.spots,
      model: () => this.requireModel(options.vision?.model ?? options.model),
      redact: options.vault.redact,
      signal: options.signal,
      onModelCall: (cost) => this.noteCall(cost),
    })
  }

  /** The session's vision mode, over which a call's own choice goes. */
  private get visionMode(): VisionMode {
    return this.options.vision?.mode ?? "auto"
  }

  /** A step's vision as its loop takes it: none when off. */
  private visionOf(mode: VisionMode) {
    return mode === "off" ? undefined : { mode, desk: this.desk }
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
      effects: options.effects ?? true,
      vision: visionFor(this.visionMode, options.vision),
      time: options.time === true,
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
        replayOnly: this.options.replayOnly === true,
        timeout: this.options.actionTimeout,
        ...this.finder(),
        redact: vault.redact,
        signal: this.options.signal,
        model: () => this.requireModel(this.options.model),
        onModelCall: (cost) => this.noteCall(cost),
        vision: this.visionOf(visionFor(this.visionMode, options.vision)),
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
    const poll = pollOf(options.poll, {
      timeout: this.options.assertionTimeout,
      interval: DEFAULT_INTERVAL_MS,
    })
    /*
     * A claim is checked even under strict replay: with no evidence recorded, or evidence that is
     * no longer shown, the judge decides it as it always did.
     */
    const judged = {
      strict: false,
      poll,
      within: this.options.assertionTimeout,
      judge: () => this.judgeContext(JUDGE_PROMPT, options.vision),
      fail: (verdict: Unheld, reason: string) => new ClaimFailed(claim, verdict, reason),
    }

    const step = {
      kind: "assert" as const,
      condition: claim,
      params: {},
      live: options.replay === false,
    }

    return this.judged(step, judged, "agent.assert")
  }

  waitFor(condition: string, options: WaitForOptions = {}): Promise<void> {
    const poll: Poll = {
      timeout: options.timeout ?? DEFAULT_WAIT_MS,
      interval: options.interval ?? DEFAULT_INTERVAL_MS,
    }
    const judged = {
      strict: this.options.strict,
      poll,
      within: poll.timeout,
      judge: () => this.judgeContext(WAIT_PROMPT),
      fail: (verdict: Unheld, reason: string) => notHeld(condition, verdict, reason, poll.timeout),
    }
    const step = { kind: "wait" as const, condition, params: options.params ?? {} }

    return this.judged(step, judged, "agent.waitFor")
  }

  /** Runs a step the judge decides, replaying the evidence it named when one was recorded. */
  private judged(
    step: Omit<JudgedStep, "index">,
    how: Pick<WaitStepContext, "strict" | "poll" | "within" | "judge" | "fail">,
    api: string,
  ): Promise<void> {
    const index = this.actCount++
    const { steps, vault } = this.options

    const body = async () => {
      this.spent.check()

      if (how.strict && this.divergence !== undefined) {
        steps.cache("diverged")

        return
      }

      await waitStep(
        { ...step, index },
        {
          ...how,
          replayOnly: this.options.replayOnly === true,
          tabs: this.options.tabs,
          store: this.options.store,
          redact: vault.redact,
          volatile: () => this.options.mail.values(),
          cache: (outcome, detail) => steps.cache(outcome, detail),
          diverge: (reason) => {
            const instruction = step.condition

            this.divergence = { step: index, instruction, reason: vault.redact(reason) }

            return this.divergence.reason
          },
        },
      )
    }

    return steps.run("agent", api, vault.redact(step.condition), body, { verifies: true })
  }

  /** The judge as a step calls it, told its job by `system`, seeing a screenshot as `vision` says. */
  private judgeContext(system: string, vision?: VisionChoice): JudgeContext {
    return {
      model: this.requireModel(this.options.judge ?? this.options.model),
      system,
      tabs: this.options.tabs,
      redact: this.options.vault.redact,
      vocabulary: this.options.context,
      screenshot: this.judgeSees(vision),
      spots: this.spots,
      signal: this.options.signal,
      onModelCall: (cost) => this.noteCall(cost),
    }
  }

  /** Whether the judge gets a screenshot: the session's `judgeScreenshot`, else by vision. */
  private judgeSees(vision: VisionChoice | undefined): boolean | "auto" {
    if (this.options.judgeScreenshot === true) return true

    const mode = visionFor(this.visionMode, vision)

    if (mode === "off") return false

    return mode === "always" ? true : "auto"
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
    const watch = await this.watchFor(call, key)
    const replayed = await this.replayRecording(key, params, files, watch)

    if (replayed.ok) {
      const models = store?.crossModel(replayed, "act") ?? {}

      steps.cache(replayed.relocated ? "relocated" : "replayed", models)
      this.checkApp(mark)

      return { summary: "replayed the recording", modelCalls: 0, actions: replayed.actions }
    }

    const miss = await this.missFor(key, replayed)

    if (this.options.replayOnly === true) {
      steps.cache(replayed.reason === undefined ? miss.mode : "diverged", divergedNote(miss))
      throw new ReplayMissing("agent.act", this.options.vault.redact(instruction), missWhy(miss))
    }

    if (this.options.strict) return this.stopStrict(index, instruction, replayed.reason, miss)

    const result = await this.runModel(call, mark).catch((error: unknown) => {
      this.noteApp(mark)
      throw error
    })

    this.checkApp(mark)
    await this.keep(key, call, result, { miss, watch, replayed: replayed.ran ?? [] })

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

  /**
   * A watch of the step's effects, when its replay must have them or its run will be recorded:
   * the session has effects on, the step did not turn them off, and there is a cache.
   */
  private async watchFor(
    call: ActCall,
    key: StepKey | undefined,
  ): Promise<EffectWatch | undefined> {
    const { effects, tabs, vault, activity } = this.options

    if (key === undefined || !call.effects || effects?.enabled === false) return undefined

    return EffectWatch.start(
      {
        tabs,
        redact: vault.redact,
        ignore: effects?.ignore ?? [],
        patience: this.options.actionTimeout,
        ...(activity !== undefined && { activity }),
      },
      this.sessionMark,
    )
  }

  /** Why the step had no usable recording: none, a stale one, or one that stopped matching. */
  private async missFor(key: StepKey | undefined, replayed: Replayed): Promise<CacheNote> {
    if (replayed.ok || replayed.reason === undefined) return missOf(this.options.store, key)

    return handedOff({ ...replayed, reason: replayed.reason }, this.options.vault.redact)
  }

  /** Replays the recording under `key`; `reason` is undefined when there is none. */
  private async replayRecording(
    key: StepKey | undefined,
    params: Params,
    files: Files,
    watch: EffectWatch | undefined,
  ): Promise<Replayed> {
    const trace = key === undefined ? undefined : await this.options.store?.read(key.key)

    if (trace === undefined || key === undefined) return { ok: false, reason: undefined }

    const outcome = await this.tryReplay(trace, params, files)

    if (outcome instanceof ReplayMismatch)
      return { ok: false, reason: outcome.message, ran: ranBefore(trace, outcome) }

    const effect = await this.checkEffects(trace, watch)

    if (effect !== undefined)
      return { ok: false, reason: `effect: ${effect}`, effect: true, ran: outcome.trace.actions }

    this.noteMoves(key, outcome)

    return {
      ok: true,
      actions: trace.actions.length,
      relocated: outcome.moved.length + outcome.movedPlaces.length > 0,
      recordedBy: trace.recordedBy,
    }
  }

  private checkEffects(trace: Trace, watch: EffectWatch | undefined): Promise<string | undefined> {
    return compareEffects(this.options.steps, trace, watch)
  }

  /** Records where moved elements were found, and keeps the recording pointing at them. */
  private noteMoves(key: StepKey, outcome: ReplayOutcome): void {
    const { steps, store } = this.options

    const moves = [
      ...outcome.moved.map((move) => ({ from: describe(move.from), to: describe(move.to) })),
      ...outcome.movedPlaces.map((move) => ({ from: move.from, to: move.to })),
    ]

    for (const move of moves) steps.event({ kind: "relocated", at: now(), ...move })

    if (moves.length > 0) store?.stage(key, steps.next - 1, outcome.trace)
  }

  /** How the replay went; otherwise where and why it stopped matching. */
  private async tryReplay(
    trace: Trace,
    params: Params,
    files: Files,
  ): Promise<ReplayOutcome | ReplayMismatch> {
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
        spots: this.spots,
        travel: this.options.travel,
        onAction: (label) =>
          this.options.steps.event({ kind: "action", at: new Date().toISOString(), label }),
      })
    } catch (error) {
      if (error instanceof ReplayMismatch) return error

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
    this.options.steps.cache("diverged", divergedNote(miss))

    return { summary: `diverged: ${this.divergence.reason}`, modelCalls: 0, actions: 0 }
  }

  private async runModel(call: ActCall, mark: FailureMark | undefined): Promise<LiveResult> {
    const { steps, vault, budgets, appErrors } = this.options
    const { instruction } = call
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
      spends: stepSpends(budgets, call.budget, `step "${vault.redact(instruction)}"`, this.spent),
      transcriptBudget: this.options.transcriptBudget,
      ready: this.options.ready,
      mail: this.options.mail,
      vision: this.visionOf(call.vision),
      travel: call.time ? this.options.travel : undefined,
      ...(appErrors !== undefined &&
        mark !== undefined && { appFailure: () => appErrors.since(mark) }),
      ...stepEvents(steps),
    })

    return passed(result, instruction, this.options.vault.redact)
  }

  /** Stages the step's actions as its recording, written once a later check confirms them. */
  private keep(
    key: StepKey | undefined,
    call: ActCall,
    result: LiveResult,
    seen: Pick<LiveRun, "miss" | "watch" | "replayed">,
  ): Promise<void> {
    const { store, steps, mail, tabs, appUrl } = this.options

    return keepRecording({
      store,
      steps,
      key,
      instruction: call.instruction,
      params: call.params,
      mail,
      recorded: result.recorded,
      ...seen,
      endRoute: () =>
        templateRoute(routeOf(tabs.page.url(), new URL(appUrl).origin), uniqueValues(call.params)),
    })
  }

  /** The model a step calls; under replay-only none may be called, whatever asks for one. */
  private requireModel(model: LanguageModel | undefined) {
    if (this.options.replayOnly === true)
      throw new DanwoError(
        "REPLAY_MISSING",
        "a step asked for the model, and replay-only runs none. Run the test without --replay-only to record it.",
      )

    return requireModel(model)
  }
}

/** The agent of one session, with the divergence of a strict replay. */
export function createAgent(
  options: AgentOptions,
): Agent & { diverged(): ReplayDivergence | undefined } {
  return new SessionAgent(options)
}
