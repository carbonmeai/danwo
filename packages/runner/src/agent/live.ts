/**
 * A step run by the model: it is shown the instruction, the params and the page, picks one tool
 * call at a time, and sees the page again after each. Only the latest view stays in the
 * conversation; older ones shrink to a line, which keeps long steps cheap. The loop stops when the
 * model calls `done`, after too many turns, or when it repeats the same action without effect.
 */
import { generateText, type LanguageModel, type ModelMessage, type ToolCallPart } from "ai"

import type { Tabs } from "../browser/tabs.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { type Params, shownParams } from "../replay/params.ts"
import type { RecordedAction } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import { viewTabs, viewText } from "../snapshot/view.ts"
import type { Files } from "./files.ts"
import { type Call, parseCall, perform } from "./perform.ts"
import { ACTOR_PROMPT } from "./prompts.ts"
import { agentTools } from "./tools.ts"

/** Separates what a message says from the page view it carries. */
const VIEW_MARK = "\n\nThe page now:\n"
const MAX_TURNS = 25
/** The same call this many times in a row means the model is stuck. */
const MAX_REPEATS = 3

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

/** The agent could not finish the step. */
export class AgentStepFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentStepFailed"
  }
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

/** Text without the page view it carried. */
function withoutView(text: string): string {
  return text.split(VIEW_MARK)[0] ?? text
}

/** Earlier messages keep what they said and drop the page views they carried. */
function compact(messages: ModelMessage[]): void {
  for (const message of messages) {
    if (message.role === "user" && typeof message.content === "string") {
      message.content = withoutView(message.content)
      continue
    }

    if (message.role !== "tool") continue

    for (const part of message.content) {
      if (part.type === "tool-result" && part.output.type === "text")
        part.output = { type: "text", value: withoutView(part.output.value) }
    }
  }
}

interface Turn {
  readonly calls: readonly ToolCallPart[]
  readonly response: readonly ModelMessage[]
}

class Loop {
  private readonly live: LiveContext
  private readonly messages: ModelMessage[] = []
  private readonly recorded: RecordedAction[] = []
  private replayable = true
  private modelCalls = 0
  private lastCall = ""
  private repeats = 0

  constructor(live: LiveContext) {
    this.live = live
  }

  run(instruction: string): Promise<LiveResult> {
    return this.live.tabs.holdingDialogs(() => this.loop(instruction))
  }

  private async loop(instruction: string): Promise<LiveResult> {
    let view = await this.look()

    this.messages.push({
      role: "user",
      content: firstMessage(instruction, this.live, viewText(view)),
    })

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { calls, response } = await this.ask()
      const done = calls.find((call) => call.toolName === "done")

      this.messages.push(...response)
      if (done !== undefined) return this.finish(done.input)

      if (calls.length === 0) {
        this.messages.push({ role: "user", content: "Answer with a tool call." })
        continue
      }

      const results = await this.carryOut(calls, view.tree)

      view = await this.look()
      compact(this.messages)
      this.messages.push({
        role: "tool",
        content: this.resultsWithView(calls, results, viewText(view)),
      })
    }

    throw new AgentStepFailed(`the agent did not finish "${instruction}" within ${MAX_TURNS} turns`)
  }

  private look() {
    return viewTabs(this.live.tabs, this.live.vault.redact)
  }

  private async ask(): Promise<Turn> {
    const result = await generateText({
      model: this.live.model,
      system: ACTOR_PROMPT,
      messages: this.messages,
      tools: agentTools,
      toolChoice: "required",
      ...(this.live.signal && { abortSignal: this.live.signal }),
    })

    this.modelCalls++
    this.live.onModelCall(callCost(result.usage, result.providerMetadata))

    const calls = result.response.messages.flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string"
        ? message.content.filter((part): part is ToolCallPart => part.type === "tool-call")
        : [],
    )

    return { calls, response: result.response.messages }
  }

  private async carryOut(calls: readonly ToolCallPart[], tree: string): Promise<string[]> {
    const outcomes: string[] = []

    for (const raw of calls) {
      const call = parseCall(raw.toolName, raw.input)

      outcomes.push(
        call === undefined ? `not a valid ${raw.toolName} call` : await this.act(call, tree),
      )
    }

    return outcomes
  }

  private async act(call: Call, tree: string): Promise<string> {
    const signature = JSON.stringify(call)

    this.repeats = signature === this.lastCall ? this.repeats + 1 : 1
    this.lastCall = signature
    if (this.repeats >= MAX_REPEATS)
      throw new AgentStepFailed(
        `the agent repeated ${call.name} ${MAX_REPEATS} times without getting further`,
      )

    try {
      const performed = await perform(call, { ...this.live, tree })

      this.live.onAction(`${call.name} ${this.live.vault.redact(JSON.stringify(call.input))}`)
      if (performed.recorded === null) this.replayable = false
      else this.recorded.push(performed.recorded)

      return performed.outcome
    } catch (error) {
      return `failed: ${this.live.vault.redact(error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error))}`
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
