/**
 * Scripted stand-ins for the actor and judge models. This file is the one place the contract
 * tests know the agent's wire protocol: how the page reaches the model (an accessibility tree
 * with refs, `- button "Save" [ref=e12]`), the tool names (`click`, `fill`, `fill_secret`,
 * `done`), how params are shown (`Params: {"name":"…"}`) and the judge's answer shape. When the
 * agent's protocol changes, update this file; the tests stay as they are.
 */
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function toolCall(toolName: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${toolName}-${Math.random()}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  }
}

function textAnswer(value: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  }
}

/** Every string in a prompt, joined: what the model would read. */
function promptText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(promptText).join("\n")
  if (value && typeof value === "object") return Object.values(value).map(promptText).join("\n")

  return ""
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** One thing the scripted actor does to an element it finds by role and accessible name. */
export type ScriptedAction =
  | { readonly click: { readonly role: string; readonly name: string } }
  | {
      readonly type: { readonly role: string; readonly name: string }
      /** Types the value of this `act` param, as the model was shown it. */
      readonly param: string
    }
  | {
      readonly typeSecret: { readonly role: string; readonly name: string }
      readonly secret: string
    }

export interface ScriptedActor extends MockLanguageModelV4 {
  /** Every prompt the actor was sent, as text. */
  readonly prompts: string[]
}

function nodeId(text: string, target: { role: string; name: string }): string {
  const pattern = new RegExp(
    `- ${target.role} ${escapeRegExp(JSON.stringify(target.name))}[^\\n]*?\\[ref=([a-z0-9]+)\\]`,
  )
  const id = pattern.exec(text)?.[1]

  if (!id) throw new Error(`scripted actor: no ${target.role} "${target.name}" on screen`)

  return id
}

function toolResults(options: LanguageModelV4CallOptions): number {
  return options.prompt.filter((message) => message.role === "tool").length
}

function nextCall(action: ScriptedAction, text: string): LanguageModelV4GenerateResult {
  if ("click" in action) return toolCall("click", { ref: nodeId(text, action.click) })
  if ("typeSecret" in action)
    return toolCall("fill_secret", { ref: nodeId(text, action.typeSecret), secret: action.secret })

  const shown = new RegExp(`"${escapeRegExp(action.param)}":("(?:[^"\\\\]|\\\\.)*")`).exec(
    text,
  )?.[1]

  if (shown === undefined) throw new Error(`scripted actor: no param "${action.param}" shown`)

  const value: unknown = JSON.parse(shown)

  return toolCall("fill", { ref: nodeId(text, action.type), text: value })
}

/** An actor that performs `actions` in order, one tool call per turn, then ends the step. */
export function scriptedActor(actions: readonly ScriptedAction[]): ScriptedActor {
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted-actor",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const text = promptText(options.prompt.filter((message) => message.role !== "system"))
      const done = toolResults(options)
      const action = actions[done]

      prompts.push(text)
      if (!action) return toolCall("done", { status: "passed", summary: "done" })

      return nextCall(action, text)
    },
  })

  return Object.assign(model, { prompts })
}

/** A judge that always answers `verdict`, explaining itself with `scripted: <verdict>`. */
export function scriptedJudge(verdict: "holds" | "fails"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: `judge-${verdict}`,
    doGenerate: async () => textAnswer({ verdict, reason: `scripted: ${verdict}` }),
  })
}
