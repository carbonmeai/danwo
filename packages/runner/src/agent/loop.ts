/**
 * The turn loop a live step runs, whatever it drives (a browser page or a device): show the model
 * the instruction and the screen, take one tool call at a time, carry it out, and show the screen
 * again. The conversation only grows, so providers can cache it, until it passes its size budget
 * and older views are dropped in one go (see transcript.ts). The loop stops when the model calls
 * `done`, when the step's or test's budget is spent, or when the agent keeps going round in
 * circles after being warned once. A subclass says how the screen is read and how calls are done.
 */
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type ToolCallPart,
  type ToolSet,
} from "ai"

import { callCost, type CallCost } from "../model/resolve.ts"
import type { RecordedAction } from "../replay/trace.ts"
import { DanwoError } from "../support/codes.ts"
import type { Spends } from "./budget.ts"
import { AgentStepFailed } from "./errors.ts"
import { LoopGuard } from "./guard.ts"
import { Transcript, VIEW_MARK } from "./transcript.ts"

/** Unusable answers in a row after the first that the model is asked again for. */
const MAX_UNUSABLE = 2

/** Errors the AI SDK raises for an answer it could not take, rather than a failed call. */
const UNUSABLE_ANSWER: readonly string[] = [
  "AI_ToolChoiceViolationError",
  "AI_NoSuchToolError",
  "AI_InvalidToolInputError",
]

const NO_TOOL_CALL =
  "Your answer had no tool call. Answer with exactly one call of the tools you were given; call `done` when the step is finished."

/** What every loop needs of its step. */
export interface LoopContext {
  readonly model: Exclude<LanguageModel, string>
  readonly signal?: AbortSignal | undefined
  /** What the step and its test may still spend. */
  readonly spends: Spends
  /** The conversation's size budget in characters before older views are dropped. */
  readonly transcriptBudget?: number | undefined
  /** How the app failed since the step began, if it did; the step stops at once. */
  readonly appFailure?: () => Error | undefined
  readonly redact: (text: string) => string
  readonly onModelCall: (cost: CallCost) => void
  readonly onAction: (label: string) => void
}

/** How a live step ended. */
export interface LoopResult {
  readonly status: "passed" | "failed"
  readonly summary: string
  readonly modelCalls: number
  /** The step's actions in order; null when one of them cannot be replayed. */
  readonly recorded: readonly RecordedAction[] | null
}

/** What carrying out one call came to: what the model is told, and whether it failed. */
export interface Outcome {
  readonly text: string
  readonly failed: boolean
}

/** What carrying out one call did: the outcome, and the action as recorded. */
export interface StepAction {
  readonly outcome: string
  /** The action as recorded; null when it cannot be replayed, undefined when it changes nothing. */
  readonly recorded: RecordedAction | null | undefined
}

/** The tool calls in a model's answer. */
export function toolCallsOf(messages: readonly ModelMessage[]): ToolCallPart[] {
  return messages.flatMap((message) =>
    message.role === "assistant" && typeof message.content !== "string"
      ? message.content.filter((part): part is ToolCallPart => part.type === "tool-call")
      : [],
  )
}

function parseDone(input: unknown): Pick<LoopResult, "status" | "summary"> {
  if (typeof input === "object" && input !== null && "status" in input) {
    const status = input.status === "failed" ? "failed" : "passed"
    const summary = "summary" in input && typeof input.summary === "string" ? input.summary : ""

    return { status, summary }
  }

  return { status: "failed", summary: "the agent ended the step without saying how it went" }
}

/** A loop over one kind of screen (`View`), its calls (`Call`) and what they come to. */
export abstract class ToolLoop<View, Call, Done extends Outcome> {
  protected readonly loop: LoopContext
  protected readonly transcript: Transcript
  private readonly guard = new LoopGuard()
  private readonly recorded: RecordedAction[] = []
  private replayable = true
  private modelCalls = 0
  /** Answers in a row that could not be used: no tool call, or only malformed ones. */
  private unusableInARow = 0

  constructor(loop: LoopContext) {
    this.loop = loop
    this.transcript = new Transcript(loop.transcriptBudget)
  }

  /** Reads the screen. */
  protected abstract look(): Promise<View>
  /** The screen as the model reads it. */
  protected abstract viewFor(view: View): Promise<string> | string
  /** The first message's lines before the view: the instruction, params, context. */
  protected abstract opening(instruction: string): string
  /** Shows the model what the turn's outcomes took (screenshots), or a fresh look. */
  protected abstract showScreen(view: View, outcomes: readonly Done[]): Promise<void>
  protected abstract parse(
    name: string,
    input: unknown,
  ): { readonly call: Call } | { readonly problem: string }
  /** Carries out one call on the screen `view` shows; throws when it cannot. */
  protected abstract perform(
    call: Call,
    view: View,
  ): Promise<StepAction & Omit<Done, "text" | "failed">>
  protected abstract system(): string
  protected abstract tools(): ToolSet
  /** The call as the step's record shows it. */
  protected abstract label(call: Call): string

  /** Runs the step until the model calls `done`. */
  protected async turns(instruction: string): Promise<LoopResult> {
    let view = await this.look()

    this.transcript.push({
      role: "user",
      content: `${this.opening(instruction)}${VIEW_MARK}${await this.viewFor(view)}`,
    })
    await this.showScreen(view, [])

    for (;;) {
      this.loop.spends.check()
      this.loop.spends.step.turn()

      const { calls, response } = await this.ask()
      const done = calls.find((call) => call.toolName === "done")

      this.transcript.push(...response)
      if (done !== undefined) return this.finish(done.input)

      if (calls.length === 0) {
        this.unusable("the answer had no tool call")
        this.transcript.push({ role: "user", content: NO_TOOL_CALL })
        continue
      }

      const outcomes = await this.carryOut(calls, view)
      const failure = this.loop.appFailure?.()

      /* On a broken app the agent would only wander; the step ends with what broke. */
      if (failure !== undefined) throw failure

      view = await this.look()
      this.transcript.push({
        role: "tool",
        content: this.results(
          calls,
          outcomes.map((outcome) => outcome.text),
          await this.viewFor(view),
        ),
      })
      await this.showScreen(view, outcomes)
      this.transcript.compactIfOver()
    }
  }

  /**
   * Notes an answer that could not be used; after `MAX_UNUSABLE` in a row the step gives up with
   * `MODEL_OUTPUT_INVALID`, which says nothing about the app.
   */
  private unusable(problem: string): void {
    this.unusableInARow++
    if (this.unusableInARow > MAX_UNUSABLE)
      throw new DanwoError(
        "MODEL_OUTPUT_INVALID",
        `the model's answers could not be used ${this.unusableInARow} times in a row: ${problem}`,
      )
  }

  private async ask(): Promise<{
    readonly calls: readonly ToolCallPart[]
    readonly response: readonly ModelMessage[]
  }> {
    const result = await generateText({
      model: this.loop.model,
      system: this.system(),
      messages: this.transcript.forModel(),
      tools: this.tools(),
      toolChoice: "required",
      ...(this.loop.signal && { abortSignal: this.loop.signal }),
    }).catch((error: unknown) => {
      /* An answer the SDK refused (no tool call when one is required) is unusable, not a crash. */
      if (error instanceof Error && UNUSABLE_ANSWER.includes(error.name)) return undefined

      throw error
    })

    this.modelCalls++
    if (result === undefined) return { calls: [], response: [] }

    const used = callCost(result.usage, result.providerMetadata)
    const cost = this.unusableInARow > 0 ? { ...used, retry: true } : used

    this.loop.spends.call(cost)
    this.loop.onModelCall(cost)

    return { calls: toolCallsOf(result.response.messages), response: result.response.messages }
  }

  private async carryOut(calls: readonly ToolCallPart[], view: View): Promise<Done[]> {
    const outcomes: Done[] = []
    const parsed = calls.map((raw) => this.parse(raw.toolName, raw.input))
    const problems = parsed.flatMap((one) => ("problem" in one ? [one.problem] : []))

    /* A turn whose every call was malformed is an unusable answer; one good call resets the count. */
    if (problems.length === calls.length) this.unusable(problems.join("; "))
    else this.unusableInARow = 0

    for (const [index, raw] of calls.entries()) {
      const one = parsed[index]
      const outcome =
        one === undefined || "problem" in one
          ? this.failed(
              `not a valid ${raw.toolName} call (${one?.problem ?? "unknown"}); fix the input and call it again`,
            )
          : await this.act(one.call, view)

      outcomes.push({
        ...outcome,
        text: this.guarded(JSON.stringify(raw.input) + raw.toolName, outcome),
      })
    }

    return outcomes
  }

  /** A failed outcome with `text`. */
  private failed(text: string): Done {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a failed outcome carries nothing beyond its text, which every Done allows
    return { text, failed: true } as Done
  }

  /** The outcome as the model is told it, with the guard's warning when the agent is stuck. */
  private guarded(signature: string, outcome: Outcome): string {
    const verdict = this.guard.note(signature, outcome.failed)

    if (verdict.kind === "stop") throw new AgentStepFailed(verdict.reason, "AGENT_LOOPING")

    return verdict.kind === "warn" ? `${outcome.text}\n\nWarning: ${verdict.message}` : outcome.text
  }

  private async act(call: Call, view: View): Promise<Done> {
    try {
      const { outcome, recorded, ...rest } = await this.perform(call, view)

      this.loop.onAction(this.label(call))
      if (recorded === null) this.replayable = false
      else if (recorded !== undefined) this.recorded.push(recorded)

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the rest of a Done is what perform gave besides its outcome and recording
      return { ...rest, text: outcome, failed: false } as unknown as Done
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)

      return this.failed(`failed: ${this.loop.redact(message)}`)
    }
  }

  private results(calls: readonly ToolCallPart[], outcomes: readonly string[], view: string) {
    return calls.map((call, index) => ({
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: {
        type: "text" as const,
        value:
          index === calls.length - 1
            ? `${outcomes[index] ?? ""}${VIEW_MARK}${view}`
            : (outcomes[index] ?? ""),
      },
    }))
  }

  private finish(input: unknown): LoopResult {
    return {
      ...parseDone(input),
      modelCalls: this.modelCalls,
      recorded: this.replayable ? [...this.recorded] : null,
    }
  }
}
