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

import type { Tabs } from "../browser/tabs.ts"
import { resolveModel } from "../model/resolve.ts"
import type { StepRecorder } from "../record/index.ts"
import type { Params } from "../replay/params.ts"
import { findOrRelocate } from "../replay/relocate.ts"
import {
  replay,
  ReplayMismatch,
  type ReplayOutcome,
  type TargetFinder,
} from "../replay/replayer.ts"
import { routeOf } from "../replay/route.ts"
import type { ReplayStore } from "../replay/store.ts"
import { describe } from "../replay/target.ts"
import type { Trace } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import { NothingRecorded } from "./errors.ts"
import { extractStep } from "./extract-step.ts"
import { ExtractFailed } from "./extract.ts"
import type { Files } from "./files.ts"
import { judge } from "./judge.ts"
import { AgentStepFailed, type LiveResult, runLive } from "./live.ts"
import type { ActOptions, ActResult, Agent, ExtractOptions } from "./types.ts"

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
  /** Outside strict replay, find a recorded element that moved instead of handing the step back. */
  readonly relocate: boolean
  readonly model: LanguageModel | undefined
  readonly judge: LanguageModel | undefined
  readonly context?: string | undefined
  readonly actionTimeout: number
  readonly signal?: AbortSignal | undefined
}

class SessionAgent implements Agent {
  private readonly options: AgentOptions
  private divergence: ReplayDivergence | undefined
  private actCount = 0

  constructor(options: AgentOptions) {
    this.options = options
  }

  diverged(): ReplayDivergence | undefined {
    return this.divergence
  }

  act(instruction: string, options: ActOptions = {}): Promise<ActResult> {
    const index = this.actCount++
    const label = this.options.vault.redact(instruction)

    return this.options.steps.run("agent", "agent.act", label, () =>
      this.step(index, instruction, options.params ?? {}, this.filesOf(options)),
    )
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
    const at = () => new Date().toISOString()

    return steps.run("agent", "agent.extract", vault.redact(instruction), () => {
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
        onModelCall: (cost) => steps.event({ kind: "model", at: at(), ...cost }),
        onAction: (label) => steps.event({ kind: "action", at: at(), label }),
        onRelocated: (from, to) =>
          steps.event({ kind: "relocated", at: at(), from: describe(from), to: describe(to) }),
        cache: (outcome) => steps.cache(outcome),
        diverge: (reason) => {
          this.divergence = { step: index, instruction, reason: vault.redact(reason) }

          return this.divergence.reason
        },
      })
    })
  }

  assert(claim: string): Promise<void> {
    const { steps } = this.options

    return steps.run(
      "agent",
      "agent.assert",
      this.options.vault.redact(claim),
      () =>
        judge(claim, {
          model: this.requireModel(this.options.judge ?? this.options.model),
          tabs: this.options.tabs,
          redact: this.options.vault.redact,
          signal: this.options.signal,
          onModelCall: (cost) =>
            steps.event({ kind: "model", at: new Date().toISOString(), ...cost }),
        }),
      { verifies: true },
    )
  }

  private async step(
    index: number,
    instruction: string,
    params: Params,
    files: Files,
  ): Promise<ActResult> {
    const { steps, store } = this.options

    if (this.divergence !== undefined) return this.skipped(this.divergence)

    const key = store?.key(instruction, params)
    const replayed = await this.replayRecording(key, params, files)

    if (replayed.ok) {
      steps.cache(replayed.relocated ? "relocated" : "replayed")

      return { summary: "replayed the recording", modelCalls: 0, actions: replayed.actions }
    }

    if (this.options.strict) return this.stopStrict(index, instruction, replayed.reason)

    const result = await this.runModel(instruction, params, files)

    this.keep(key, instruction, result, replayed.reason === undefined ? "recorded" : "healed")

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
    key: string | undefined,
    params: Params,
    files: Files,
  ): Promise<
    { ok: true; actions: number; relocated: boolean } | { ok: false; reason: string | undefined }
  > {
    const trace = key === undefined ? undefined : await this.options.store?.read(key)

    if (trace === undefined || key === undefined) return { ok: false, reason: undefined }

    const outcome = await this.tryReplay(trace, params, files)

    if (typeof outcome === "string") return { ok: false, reason: outcome }

    this.noteMoves(key, outcome)

    return { ok: true, actions: trace.actions.length, relocated: outcome.moved.length > 0 }
  }

  /** Records where moved elements were found, and keeps the recording pointing at them. */
  private noteMoves(key: string, outcome: ReplayOutcome): void {
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
        onAction: (label) =>
          this.options.steps.event({ kind: "action", at: new Date().toISOString(), label }),
      })
    } catch (error) {
      if (error instanceof ReplayMismatch) return error.message

      throw error
    }
  }

  /** Relocation, when this session allows it: never under strict replay. */
  private finder(): { find?: TargetFinder } {
    if (this.options.strict || !this.options.relocate) return {}

    return {
      find: (target, timeout) => findOrRelocate(this.options.tabs.page, target, timeout),
    }
  }

  private stopStrict(index: number, instruction: string, reason: string | undefined): ActResult {
    if (reason === undefined) {
      this.options.steps.cache("unrecorded")
      throw new NothingRecorded(index, instruction)
    }

    this.divergence = { step: index, instruction, reason: this.options.vault.redact(reason) }
    this.options.steps.cache("diverged")

    return { summary: `diverged: ${this.divergence.reason}`, modelCalls: 0, actions: 0 }
  }

  private async runModel(instruction: string, params: Params, files: Files): Promise<LiveResult> {
    const { steps } = this.options
    const at = () => new Date().toISOString()
    const result = await runLive(instruction, {
      model: this.requireModel(this.options.model),
      tabs: this.options.tabs,
      appUrl: this.options.appUrl,
      vault: this.options.vault,
      params,
      files,
      timeout: this.options.actionTimeout,
      context: this.options.context,
      signal: this.options.signal,
      onModelCall: (cost) => steps.event({ kind: "model", at: at(), ...cost }),
      onAction: (label) => steps.event({ kind: "action", at: at(), label }),
    })

    if (result.status === "failed")
      throw new AgentStepFailed(
        `agent.act(${JSON.stringify(instruction)}) failed: ${this.options.vault.redact(result.summary)}`,
      )

    return result
  }

  /** Stages the step's actions as its recording, written once a later check confirms them. */
  private keep(
    key: string | undefined,
    instruction: string,
    result: LiveResult,
    mode: "recorded" | "healed",
  ): void {
    const { store, steps } = this.options

    if (store === undefined || key === undefined || result.recorded === null || !store.writes) {
      steps.cache(store?.reads ? "unrecorded" : "off")

      return
    }

    store.stage(key, steps.next - 1, {
      version: 1,
      instruction,
      recordedAt: new Date().toISOString(),
      actions: [...result.recorded],
      endRoute: routeOf(this.options.tabs.page.url(), new URL(this.options.appUrl).origin),
    })
    steps.cache(mode)
  }

  private requireModel(model: LanguageModel | undefined) {
    if (model === undefined)
      throw new Error("this session has no model: pass `model` to use agent.act and agent.assert")

    return resolveModel(model)
  }
}

/** The agent of one session, with the divergence of a strict replay. */
export function createAgent(
  options: AgentOptions,
): Agent & { diverged(): ReplayDivergence | undefined } {
  return new SessionAgent(options)
}
