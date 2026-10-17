/**
 * A scripted stand-in for the agent's model: it makes the tool calls a test lists, one per turn,
 * finding elements in the view it was shown by role and name.
 */
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

/**
 * A tool call the scripted model makes, given the latest view it was shown and the whole
 * conversation so far (tool results included).
 */
export type Move = (
  view: string,
  conversation: string,
) => readonly [tool: string, input: Record<string, unknown>]

export function call(tool: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `${tool}-${Math.random()}`,
        toolName: tool,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  }
}

export function text(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(text).join("\n")
  if (value && typeof value === "object") return Object.values(value).map(text).join("\n")

  return ""
}

/** The latest view in a prompt: the text after its last "The page now:". */
function latestView(options: LanguageModelV4CallOptions): string {
  const all = text(options.prompt.filter((message) => message.role !== "system"))

  return all.slice(all.lastIndexOf("The page now:"))
}

/** The ref of the first element with `role` whose line contains `name`. */
export function ref(view: string, role: string, name: string): string {
  const line = view.split("\n").find((entry) => entry.includes(`- ${role}`) && entry.includes(name))
  const found = line === undefined ? undefined : /\[ref=([a-z0-9]+)\]/.exec(line)?.[1]

  if (found === undefined) throw new Error(`scripted model: no ${role} ${name} in\n${view}`)

  return found
}

/** A model that makes `moves` in order, one per turn, then ends the step. */
export function scripted(moves: readonly Move[]) {
  const views: string[] = []
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "toolbox-actor",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const view = latestView(options)
      const turn = options.prompt.filter((message) => message.role === "tool").length
      const move = moves[turn]
      const conversation = text(options.prompt.filter((message) => message.role !== "system"))

      views.push(view)
      prompts.push(conversation)
      if (move === undefined) return call("done", { status: "passed", summary: "done" })

      const [tool, input] = move(view, conversation)

      return call(tool, input)
    },
  })

  return Object.assign(model, { views, prompts })
}
