/**
 * `agent.act`, `extract`, `assert` and `waitFor` on a device, with the web agent's contract: a step
 * first replays its recording with no model; under strict replay one that no longer replays stops
 * the session's agent there and a step with no recording fails; otherwise the model carries the
 * step out and its actions become the recording once a later check confirms them. A replay must
 * have its recording's effects (what appeared and went on the screen, the provider calls behind
 * it), and moved elements are found again as the relocation policy allows.
 */
import type { LanguageModel } from "ai"
import type { z } from "zod"

import type { AgentOptions, ReplayDivergence } from "../../agent/agent.ts"
import { type Budget, Spend } from "../../agent/budget.ts"
import { type BackendMark, EffectWatch, markOf } from "../../agent/effect-watch.ts"
import { ExtractFailed } from "../../agent/extract.ts"
import { type JudgeInput, judgeScreen, judgeScreenUntil, type Poll } from "../../agent/judge.ts"
import type { LoopResult } from "../../agent/loop.ts"
import { missError, missOf } from "../../agent/miss.ts"
import {
  compareEffects,
  keepRecording,
  pollOf,
  requireModel,
  passed,
  stepEvents,
  stepSpends,
} from "../../agent/recording.ts"
import type {
  ActOptions,
  ActResult,
  Agent,
  AssertOptions,
  ExtractOptions,
  WaitForOptions,
} from "../../agent/types.ts"
import type { CallCost } from "../../model/resolve.ts"
import type { CacheNote } from "../../record/steps.ts"
import { embedsValue, type Params } from "../../replay/params.ts"
import { relocates } from "../../replay/policy.ts"
import { ReplayMismatch } from "../../replay/replayer.ts"
import type { StepKey } from "../../replay/store.ts"
import type { Trace } from "../../replay/trace.ts"
import { DanwoError } from "../../support/codes.ts"
import { visionFor, type VisionChoice, type VisionMode } from "../../vision/desk.ts"
import type { DeviceTarget } from "../types.ts"
import { readUntil, waitForText } from "./act.ts"
import { extractOnDevice, readSources } from "./extract.ts"
import { DeviceEyes, unnamed } from "./eyes.ts"
import { runOnDevice } from "./live.ts"
import { DEVICE_JUDGE_PROMPT, DEVICE_WAIT_PROMPT } from "./prompts.ts"
import { type DeviceReplayOutcome, replayOnDevice } from "./replay.ts"
import { type DeviceView, deviceRoute, deviceView, deviceViewText } from "./view.ts"

const DEFAULT_WAIT_MS = 30_000
const DEFAULT_INTERVAL_MS = 1_000

function now(): string {
  return new Date().toISOString()
}

/** What the device agent takes: the web agent's options, with a device in place of a page. */
export type DeviceAgentOptions = Omit<
  AgentOptions,
  "tabs" | "appUrl" | "files" | "projectRoot" | "appErrors" | "travel"
> & {
  readonly target: DeviceTarget
}

/** One `act` call. */
interface ActCall {
  readonly index: number
  readonly instruction: string
  readonly params: Params
  readonly budget: Budget | undefined
  readonly effects: boolean
  readonly vision: VisionMode
}

class DeviceAgent implements Agent {
  private readonly options: DeviceAgentOptions
  private divergence: ReplayDivergence | undefined
  private count = 0
  private readonly spent: Spend
  private readonly sessionMark: BackendMark
  readonly eyes: DeviceEyes

  constructor(options: DeviceAgentOptions) {
    this.options = options
    this.spent = new Spend(options.budgets?.test ?? {}, "test")
    this.sessionMark = markOf(options.activity)
    this.eyes = new DeviceEyes(options.target)
  }

  diverged(): ReplayDivergence | undefined {
    return this.divergence
  }

  private get visionMode(): VisionMode {
    return this.options.vision?.mode ?? "auto"
  }

  private async look(): Promise<DeviceView> {
    const { target, vault } = this.options

    return deviceView(await target.read(), await target.foreground(), vault.redact)
  }

  private noteCall(cost: CallCost): void {
    this.spent.call(cost)
    this.options.steps.event({ kind: "model", at: now(), ...cost })
  }

  private requireModel(model: LanguageModel | undefined) {
    return requireModel(model)
  }

  private diverge(index: number, instruction: string, reason: string): string {
    this.divergence = { step: index, instruction, reason: this.options.vault.redact(reason) }

    return this.divergence.reason
  }

  /**
   * Under strict replay a step with nothing recorded fails, and one whose recording no longer
   * replays stops the session's agent there; the reason, as the divergence keeps it.
   */
  private stopStrict(
    index: number,
    instruction: string,
    reason: string | undefined,
    miss: CacheNote,
  ): string {
    const { steps } = this.options

    if (reason === undefined) {
      steps.cache(miss.mode, miss)
      throw missError(index, instruction, miss)
    }

    steps.cache("diverged", miss.because === undefined ? {} : { because: miss.because })

    return this.diverge(index, instruction, reason)
  }

  act(instruction: string, options: ActOptions = {}): Promise<ActResult> {
    const call: ActCall = {
      index: this.count++,
      instruction,
      params: options.params ?? {},
      budget: options.budget,
      effects: options.effects ?? true,
      vision: visionFor(this.visionMode, options.vision),
    }

    return this.options.steps.run(
      "agent",
      "agent.act",
      this.options.vault.redact(instruction),
      () => this.step(call),
    )
  }

  private async step(call: ActCall): Promise<ActResult> {
    const { steps, store, strict } = this.options

    if (this.divergence !== undefined) {
      steps.cache("diverged")

      return {
        summary: `not run: the replay diverged at step ${this.divergence.step}`,
        modelCalls: 0,
        actions: 0,
      }
    }

    const key = store?.key({
      kind: "act",
      step: call.index,
      instruction: call.instruction,
      params: call.params,
    })
    const watch = await this.watchFor(call, key)
    const replayed = await this.replayRecording(key, call.params, watch)

    if (replayed.ok) {
      steps.cache(replayed.relocated ? "relocated" : "replayed")

      return { summary: "replayed the recording", modelCalls: 0, actions: replayed.actions }
    }

    const miss: CacheNote =
      replayed.reason === undefined
        ? await missOf(store, key)
        : { mode: "handed-off", ...(replayed.effect === true && { because: "effect" }) }

    if (strict) {
      const reason = this.stopStrict(call.index, call.instruction, replayed.reason, miss)

      return { summary: `diverged: ${reason}`, modelCalls: 0, actions: 0 }
    }

    const result = await this.runModel(call)

    await this.keep(key, call, result, { miss, watch })

    return {
      summary: result.summary,
      modelCalls: result.modelCalls,
      actions: result.recorded?.length ?? 0,
    }
  }

  /** A watch of the step's effects, when its replay must have them or its run will be recorded. */
  private async watchFor(
    call: ActCall,
    key: StepKey | undefined,
  ): Promise<EffectWatch | undefined> {
    const { effects, vault, activity } = this.options

    if (key === undefined || !call.effects || effects?.enabled === false) return undefined

    return EffectWatch.start(
      {
        tree: async () => (await this.look()).tree,
        redact: vault.redact,
        ignore: effects?.ignore ?? [],
        ...(activity !== undefined && { activity }),
      },
      this.sessionMark,
    )
  }

  private async replayRecording(
    key: StepKey | undefined,
    params: Params,
    watch: EffectWatch | undefined,
  ): Promise<
    | { readonly ok: true; readonly actions: number; readonly relocated: boolean }
    | { readonly ok: false; readonly reason: string | undefined; readonly effect?: boolean }
  > {
    const { steps, store } = this.options
    const trace = key === undefined ? undefined : await store?.read(key.key)

    if (trace === undefined || key === undefined) return { ok: false, reason: undefined }

    const outcome = await this.tryReplay(trace, params)

    if (typeof outcome === "string") return { ok: false, reason: outcome }

    const effect = await compareEffects(steps, trace, watch)

    if (effect !== undefined) return { ok: false, reason: `effect: ${effect}`, effect: true }

    for (const move of outcome.moved) steps.event({ kind: "relocated", at: now(), ...move })
    if (outcome.moved.length > 0) store?.stage(key, steps.next - 1, outcome.trace)

    return { ok: true, actions: trace.actions.length, relocated: outcome.moved.length > 0 }
  }

  /** How the replay went; otherwise why it did not. */
  private async tryReplay(trace: Trace, params: Params): Promise<DeviceReplayOutcome | string> {
    const { steps, strict } = this.options

    try {
      return await replayOnDevice(trace, {
        target: this.options.target,
        timeout: this.options.actionTimeout,
        ready: this.options.ready,
        vault: this.options.vault,
        params,
        mail: this.options.mail,
        relocating: !strict && relocates(this.options.relocation),
        eyes: this.eyes,
        onAction: (label) => steps.event({ kind: "action", at: now(), label }),
      })
    } catch (error) {
      if (error instanceof ReplayMismatch) return error.message

      throw error
    }
  }

  private async runModel(call: ActCall): Promise<LoopResult> {
    const { steps, vault, budgets } = this.options
    const result = await runOnDevice(call.instruction, {
      target: this.options.target,
      timeout: this.options.actionTimeout,
      ready: this.options.ready,
      model: this.requireModel(this.options.model),
      vault,
      params: call.params,
      mail: this.options.mail,
      context: this.options.context,
      signal: this.options.signal,
      spends: stepSpends(
        budgets,
        call.budget,
        `step "${vault.redact(call.instruction)}"`,
        this.spent,
      ),
      transcriptBudget: this.options.transcriptBudget,
      vision: call.vision === "off" ? undefined : { mode: call.vision, eyes: this.eyes },
      ...stepEvents(steps),
    })

    return passed(result, call.instruction, vault.redact)
  }

  /** Stages the step's actions as its recording, written once a later check confirms them. */
  private keep(
    key: StepKey | undefined,
    call: ActCall,
    result: LoopResult,
    seen: { readonly miss: CacheNote; readonly watch: EffectWatch | undefined },
  ): Promise<void> {
    const { store, steps, mail, target } = this.options

    return keepRecording({
      store,
      steps,
      key,
      instruction: call.instruction,
      params: call.params,
      mail,
      recorded: result.recorded,
      ...seen,
      endRoute: async () => deviceRoute(await target.foreground()),
    })
  }

  extract<T>(instruction: string, schema: z.ZodType<T>, options: ExtractOptions = {}): Promise<T> {
    const index = this.count++
    const { steps, vault } = this.options

    return steps.run("agent", "agent.extract", vault.redact(instruction), () =>
      this.extractStep(index, instruction, options.params ?? {}, schema),
    )
  }

  private async extractStep<T>(
    index: number,
    instruction: string,
    params: Params,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { steps, store, strict } = this.options

    this.spent.check()

    if (this.divergence !== undefined) {
      steps.cache("diverged")
      throw new ExtractFailed(
        instruction,
        `not run: the replay diverged at step ${this.divergence.step}`,
      )
    }

    const key = store?.key({ kind: "extract", step: index, instruction, params })
    const replayed = await this.rereadSources(key, schema)

    if (replayed !== undefined && "value" in replayed) {
      steps.cache("replayed")

      return replayed.value
    }

    const reason = replayed?.reason
    const miss = await this.missFor(key, reason)

    if (strict)
      throw new ExtractFailed(
        instruction,
        `diverged: ${this.stopStrict(index, instruction, reason, miss)}`,
      )

    return this.extractLive(key, instruction, schema, miss)
  }

  /** Why a step had no recording to replay, or that it had one that stopped replaying. */
  private async missFor(key: StepKey | undefined, reason: string | undefined): Promise<CacheNote> {
    return reason === undefined ? missOf(this.options.store, key) : { mode: "handed-off" }
  }

  /** The recorded sources read again; undefined when there is no recording. */
  private async rereadSources<T>(
    key: StepKey | undefined,
    schema: z.ZodType<T>,
  ): Promise<{ readonly value: T } | { readonly reason: string } | undefined> {
    const trace = key === undefined ? undefined : await this.options.store?.readExtract(key.key)

    if (trace === undefined) return undefined

    let last: { reason: string } | { value: T } = { reason: "nothing was read" }
    const read = await readUntil(this.options.target, this.options.actionTimeout, (reading) => {
      last = readSources(reading.nodes, trace.fields, schema)

      return "value" in last ? last : undefined
    })

    return read ?? last
  }

  /** The model points at the values; their sources become the step's recording. */
  private async extractLive<T>(
    key: StepKey | undefined,
    instruction: string,
    schema: z.ZodType<T>,
    miss: CacheNote,
  ): Promise<T> {
    const { store, steps } = this.options
    const live = await extractOnDevice(instruction, schema, {
      model: this.requireModel(this.options.model),
      look: () => this.look(),
      signal: this.options.signal,
      onModelCall: (cost) => this.noteCall(cost),
    })
    const fields = live.sources ?? []
    const saves = key !== undefined && store?.writes === true && fields.length > 0

    if (saves)
      await store.writeExtract(key, {
        version: 1,
        kind: "extract",
        instruction,
        recordedAt: now(),
        fields: [...fields],
      })
    steps.cache(miss.mode, { ...miss, saved: saves })

    return live.value
  }

  /** What the judge sees: the screen's text, and a screenshot when asked or when the text misses parts. */
  private async see(vision: VisionChoice | undefined): Promise<JudgeInput["screen"]> {
    const view = await this.look()
    const mode = visionFor(this.visionMode, vision)
    const shows =
      this.options.judgeScreenshot === true ||
      mode === "always" ||
      (mode === "auto" && unnamed(view.nodes) > 0)
    const look = shows ? await this.eyes.look(view.nodes) : undefined

    return { text: deviceViewText(view), ...(look !== undefined && { screenshot: look.png }) }
  }

  private screenJudge(system: string, vision?: VisionChoice) {
    return {
      model: this.requireModel(this.options.judge ?? this.options.model),
      system,
      redact: this.options.vault.redact,
      vocabulary: this.options.context,
      signal: this.options.signal,
      onModelCall: (cost: CallCost) => this.noteCall(cost),
      see: () => this.see(vision),
    }
  }

  assert(claim: string, options: AssertOptions = {}): Promise<void> {
    const poll = pollOf(options.poll, {
      timeout: this.options.assertionTimeout,
      interval: DEFAULT_INTERVAL_MS,
    })

    return this.options.steps.run(
      "agent",
      "agent.assert",
      this.options.vault.redact(claim),
      () => {
        this.spent.check()

        return judgeScreen(claim, this.screenJudge(DEVICE_JUDGE_PROMPT, options.vision), poll)
      },
      { verifies: true },
    )
  }

  waitFor(condition: string, options: WaitForOptions = {}): Promise<void> {
    const index = this.count++
    const poll: Poll = {
      timeout: options.timeout ?? DEFAULT_WAIT_MS,
      interval: options.interval ?? DEFAULT_INTERVAL_MS,
    }
    const { steps, vault } = this.options

    return steps.run(
      "agent",
      "agent.waitFor",
      vault.redact(condition),
      () => this.waitStep(index, condition, options.params ?? {}, poll),
      { verifies: true },
    )
  }

  private async waitStep(
    index: number,
    condition: string,
    params: Params,
    poll: Poll,
  ): Promise<void> {
    const { steps, store, strict } = this.options

    this.spent.check()

    if (this.divergence !== undefined) {
      steps.cache("diverged")

      return
    }

    const key = store?.key({ kind: "wait", step: index, instruction: condition, params })
    const replayed = await this.watchEvidence(key, poll)

    if (replayed === true) {
      steps.cache("replayed")

      return
    }

    const miss = await this.missFor(key, replayed)

    if (strict) this.stopStrict(index, condition, replayed, miss)
    else await this.waitLive(key, condition, params, poll, miss)
  }

  /** Waits for the recorded evidence: true when it showed, why not when it did not, undefined without one. */
  private async watchEvidence(
    key: StepKey | undefined,
    poll: Poll,
  ): Promise<true | string | undefined> {
    const { store, target, ready, vault } = this.options
    const trace = key === undefined ? undefined : await store?.readWait(key.key)

    if (trace === undefined) return undefined

    const { text } = trace.evidence

    return waitForText({ target, ready, timeout: poll.timeout }, { text }).then(
      () => true as const,
      () => vault.redact(`"${text}" was not shown within ${poll.timeout} ms`),
    )
  }

  /** The judge watches until the condition holds; the text it names becomes the recording. */
  private async waitLive(
    key: StepKey | undefined,
    condition: string,
    params: Params,
    poll: Poll,
    miss: CacheNote,
  ): Promise<void> {
    const { store, steps, mail } = this.options
    const { verdict, page } = await judgeScreenUntil(
      condition,
      this.screenJudge(DEVICE_WAIT_PROMPT),
      poll,
    )

    if (verdict.verdict !== "holds")
      throw new DanwoError(
        verdict.verdict === "blocked" ? "CLAIM_BLOCKED" : "WAIT_TIMED_OUT",
        `agent.waitFor(${JSON.stringify(condition)}) did not hold within ${poll.timeout} ms: ${verdict.reason}`,
      )

    const evidence = usableEvidence(verdict.evidence, page, params, mail.values())
    const saved = evidence !== undefined && key !== undefined && store?.writes === true

    if (saved)
      await store.writeExtract(key, {
        version: 1,
        kind: "wait",
        instruction: condition,
        recordedAt: now(),
        evidence: { text: evidence },
      })
    steps.cache(miss.mode, { ...miss, saved })
  }
}

/** The judge's evidence when a recording can keep it: on the screen, and holding no value that varies. */
function usableEvidence(
  said: string | undefined,
  page: string,
  params: Params,
  volatile: readonly string[],
): string | undefined {
  const evidence = said?.trim() ?? ""

  return evidence !== "" && page.includes(evidence) && !embedsValue(evidence, params, volatile)
    ? evidence
    : undefined
}

/** The agent of one device session, with the divergence of a strict replay. */
export function createDeviceAgent(
  options: DeviceAgentOptions,
): Agent & { diverged(): ReplayDivergence | undefined; readonly eyes: DeviceEyes } {
  return new DeviceAgent(options)
}
