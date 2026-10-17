/**
 * A step run by the model: it is shown the instruction, the params and the page, picks one tool
 * call at a time, and sees the page again after each. The conversation only grows, so providers
 * can cache it, until it passes its size budget and older views are dropped in one go (see
 * transcript.ts). The loop stops when the model calls `done`, when the step's or test's budget is
 * spent, or when the agent keeps going round in circles after being warned once.
 */
import { generateText, type LanguageModel, type ModelMessage, type ToolCallPart } from "ai"

import type { Tabs } from "../browser/tabs.ts"
import type { MailDesk } from "../mail/desk.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { type Params, shownParams } from "../replay/params.ts"
import type { RecordedAction } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import { viewTabs, viewText } from "../snapshot/view.ts"
import { DanwoError } from "../support/codes.ts"
import type { Spends } from "./budget.ts"
import { AgentStepFailed } from "./errors.ts"
import type { Files } from "./files.ts"
import { LoopGuard } from "./guard.ts"
import { type Call, parseCall, perform } from "./perform.ts"
import { ACTOR_PROMPT } from "./prompts.ts"
import { agentTools } from "./tools.ts"
import { Transcript, VIEW_MARK } from "./transcript.ts"

/** No single action on an element waits longer than this, whatever the session's timeout. */
const ACTION_CAP_MS = 15_000

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

export interface LiveContext {
  readonly model: Exclude<LanguageModel, string>
  readonly tabs: Tabs
  readonly appUrl: string
  readonly vault: SecretVault
  readonly params: Params
  /** Files the step may upload, by name. */
  readonly files: Files
  readonly timeout: number
  readonly context?: string | undefined
  readonly signal?: AbortSignal | undefined
  /** What the step and its test may still spend. */
  readonly spends: Spends
  /** The conversation's size budget in characters before older views are dropped. */
  readonly transcriptBudget?: number | undefined
  /** Waits, after an action, for the page and the backend to go quiet (see readiness.ts). */
  readonly ready: () => Promise<void>
  /** How the app failed since the step began, if it did; the step stops at once. */
  readonly appFailure?: () => Error | undefined
  /** Mail the app sent, as the emulators caught it. */
  readonly mail: MailDesk
  /** Called for every model call and every action, for the step's record. */
  readonly onModelCall: (cost: CallCost) => void
  readonly onAction: (label: string) => void
}

export interface LiveResult {
  readonly status: "passed" | "failed"
  readonly summary: string
  readonly modelCalls: number
  /** The step's actions in order; null when one of them cannot be replayed. */
  readonly recorded: readonly RecordedAction[] | null
}

function firstMessage(
  instruction: string,
  live: Pick<LiveContext, "params" | "files" | "context">,
  view: string,
): string {
  const lines = [`Instruction: ${instruction}`]
  const shown = shownParams(live.params)
  const files = Object.keys(live.files)
  const context = live.context

  if (Object.keys(shown).length > 0) lines.push(`Params: ${JSON.stringify(shown)}`)
  if (files.length > 0) lines.push(`Files you may upload: ${files.join(", ")}`)
  if (context !== undefined) lines.push(`About this app: ${context}`)

  return `${lines.join("\n")}${VIEW_MARK}${view}`
}

interface Turn {
  readonly calls: readonly ToolCallPart[]
  readonly response: readonly ModelMessage[]
}

/** What carrying out an action came to: what the model is told, and whether it failed. */
interface Outcome {
  readonly text: string
  readonly failed: boolean
}

class Loop {
  private readonly live: LiveContext
  private readonly transcript: Transcript
  private readonly guard = new LoopGuard()
  private readonly recorded: RecordedAction[] = []
  private replayable = true
  private modelCalls = 0
  /** Answers in a row that could not be used: no tool call, or only malformed ones. */
  private unusableInARow = 0

  constructor(live: LiveContext) {
    this.live = live
    this.transcript = new Transcript(live.transcriptBudget)
  }

  run(instruction: string): Promise<LiveResult> {
    return this.live.tabs.holdingDialogs(() => this.loop(instruction))
  }

  private async loop(instruction: string): Promise<LiveResult> {
    let view = await this.look()

    this.transcript.push({
      role: "user",
      content: firstMessage(instruction, this.live, viewText(view)),
    })

    for (;;) {
      this.live.spends.check()
      this.live.spends.step.turn()

      const { calls, response } = await this.ask()
      const done = calls.find((call) => call.toolName === "done")

      this.transcript.push(...response)
      if (done !== undefined) return this.finish(done.input)

      if (calls.length === 0) {
        this.unusable("the answer had no tool call")
        this.transcript.push({ role: "user", content: NO_TOOL_CALL })
        continue
      }

      const outcomes = await this.carryOut(calls, view.tree)
      const failure = this.live.appFailure?.()

      /* On a broken app the agent would only wander; the step ends with what broke. */
      if (failure !== undefined) throw failure

      view = await this.look()
      this.transcript.push({
        role: "tool",
        content: this.resultsWithView(calls, outcomes, viewText(view)),
      })
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

  private look() {
    return viewTabs(this.live.tabs, this.live.vault.redact)
  }

  private async ask(): Promise<Turn> {
    const result = await generateText({
      model: this.live.model,
      system: ACTOR_PROMPT,
      messages: this.transcript.forModel(),
      tools: agentTools,
      toolChoice: "required",
      ...(this.live.signal && { abortSignal: this.live.signal }),
    }).catch((error: unknown) => {
      /* An answer the SDK refused (no tool call when one is required) is unusable, not a crash. */
      if (error instanceof Error && UNUSABLE_ANSWER.includes(error.name)) return undefined

      throw error
    })

    if (result === undefined) {
      this.modelCalls++

      return { calls: [], response: [] }
    }

    const used = callCost(result.usage, result.providerMetadata)
    const cost = this.unusableInARow > 0 ? { ...used, retry: true } : used

    this.modelCalls++
    this.live.spends.call(cost)
    this.live.onModelCall(cost)

    const calls = result.response.messages.flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string"
        ? message.content.filter((part): part is ToolCallPart => part.type === "tool-call")
        : [],
    )

    return { calls, response: result.response.messages }
  }

  private async carryOut(calls: readonly ToolCallPart[], tree: string): Promise<string[]> {
    const texts: string[] = []
    const parsed = calls.map((raw) => parseCall(raw.toolName, raw.input))
    const problems = parsed.flatMap((one) => ("problem" in one ? [one.problem] : []))

    /* A turn whose every call was malformed is an unusable answer; one good call resets the count. */
    if (problems.length === calls.length) this.unusable(problems.join("; "))
    else this.unusableInARow = 0

    for (const [index, raw] of calls.entries()) {
      const one = parsed[index]
      const outcome =
        one === undefined || "problem" in one
          ? {
              text: `not a valid ${raw.toolName} call (${one?.problem ?? "unknown"}); fix the input and call it again`,
              failed: true,
            }
          : await this.act(one.call, tree)

      texts.push(this.guarded(JSON.stringify(raw.input) + raw.toolName, outcome))
    }

    return texts
  }

  /** The outcome as the model is told it, with the guard's warning when the agent is stuck. */
  private guarded(signature: string, outcome: Outcome): string {
    const verdict = this.guard.note(signature, outcome.failed)

    if (verdict.kind === "stop") throw new AgentStepFailed(verdict.reason, "AGENT_LOOPING")

    return verdict.kind === "warn" ? `${outcome.text}\n\nWarning: ${verdict.message}` : outcome.text
  }

  private async act(call: Call, tree: string): Promise<Outcome> {
    try {
      const timeout = Math.min(this.live.timeout, ACTION_CAP_MS)
      const performed = await perform(call, { ...this.live, timeout, tree })

      this.live.onAction(`${call.name} ${this.live.vault.redact(JSON.stringify(call.input))}`)
      if (performed.recorded === null) this.replayable = false
      else if (performed.recorded !== undefined) this.recorded.push(performed.recorded)

      return { text: performed.outcome, failed: false }
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)

      return { text: `failed: ${this.live.vault.redact(message)}`, failed: true }
    }
  }

  private resultsWithView(
    calls: readonly ToolCallPart[],
    outcomes: readonly string[],
    view: string,
  ) {
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

  private finish(input: unknown): LiveResult {
    const parsed = parseDone(input)

    return {
      ...parsed,
      modelCalls: this.modelCalls,
      recorded: this.replayable ? [...this.recorded] : null,
    }
  }
}

function parseDone(input: unknown): Pick<LiveResult, "status" | "summary"> {
  if (typeof input === "object" && input !== null && "status" in input) {
    const status = input.status === "failed" ? "failed" : "passed"
    const summary = "summary" in input && typeof input.summary === "string" ? input.summary : ""

    return { status, summary }
  }

  return { status: "failed", summary: "the agent ended the step without saying how it went" }
}

/** Runs `instruction` with the model until it calls `done`. */
export function runLive(instruction: string, context: LiveContext): Promise<LiveResult> {
  return new Loop(context).run(instruction)
}
