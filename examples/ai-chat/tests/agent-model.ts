/**
 * The model danwo's own agent steps run on. That is a different model from the app's: the app's
 * calls go to the Vercel AI Gateway and danwo's emulator answers them, while the agent's calls go
 * from danwo to a real model, which needs `AI_GATEWAY_API_KEY`.
 *
 * `DANWO_MODEL` picks another: a gateway model id, or `scripted` for the small model below, which
 * plays this example's agent steps the way a person would, from the page it is shown. It lets the
 * agent tests (and the replay cache) run with no key at all.
 */
import type { LanguageModel } from "ai"

/** The agent's model unless `DANWO_MODEL` names another. */
const DEFAULT_MODEL = "anthropic/claude-sonnet-5"

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
}

/** A message of the prompt the runner sends, as far as the scripted model reads it. */
interface PromptMessage {
  readonly role: string
  readonly content: unknown
}

/** Every string in a prompt, joined: what the model reads. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return ""

  return (Array.isArray(value) ? value : Object.values(value)).map(textOf).join("\n")
}

/** One tool call as a model's answer. */
function call(toolName: string, input: unknown) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `scripted-${toolName}-${Date.now()}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: USAGE,
    warnings: [],
  }
}

/** A text answer, as the judge of `agent.assert` gives its verdict. */
function say(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: USAGE,
    warnings: [],
  }
}

/** The ref of the element with this role and name in the latest view of the page. */
function refOf(prompt: string, role: string, name: string): string {
  const at = prompt.lastIndexOf(`- ${role} ${JSON.stringify(name)}`)
  const ref = at < 0 ? undefined : /\[ref=(e\d+)\]/.exec(prompt.slice(at))?.[1]

  if (ref === undefined) throw new Error(`scripted model: no ${role} "${name}" on the page`)

  return ref
}

/** What the agent types to the assistant for the ticket step. */
const TICKET_REQUEST = "Please open a ticket for order 1042: the mug arrived broken."

/** Each step's actions in order, each from the page it acts on; `done` after the last. */
const STEPS: Readonly<Record<string, readonly ((page: string) => ReturnType<typeof call>)[]>> = {
  "ask the assistant to open a ticket for order 1042": [
    (page) => call("fill", { ref: refOf(page, "textbox", "Message"), text: TICKET_REQUEST }),
    (page) => call("click", { ref: refOf(page, "button", "Send") }),
  ],
}

/** The judge's verdict: the claim holds when the page shows a ticket was opened. */
function verdict(page: string) {
  const holds = page.includes("Ticket opened")

  return say(
    JSON.stringify({
      verdict: holds ? "holds" : "fails",
      reason: holds ? "the page shows the ticket the assistant opened" : "no ticket on the page",
      ...(holds && { evidence: "Ticket opened" }),
    }),
  )
}

/** The answer to a prompt: the judge's verdict, or the step's next action, or done. */
function answer(prompt: readonly PromptMessage[]) {
  const page = textOf(prompt.filter((message) => message.role !== "system"))

  if (/^Claim: /m.test(page)) return verdict(page)

  const step = Object.keys(STEPS).find((start) => page.includes(`Instruction: ${start}`)) ?? ""
  const next = STEPS[step]?.[prompt.filter((message) => message.role === "tool").length]

  return next === undefined ? call("done", { status: "passed", summary: "done" }) : next(page)
}

/** The scripted model, as an AI SDK language model. */
const scriptedModel = {
  specificationVersion: "v4" as const,
  provider: "danwo",
  modelId: "scripted-support-customer",
  supportedUrls: {},
  doGenerate: async (options: { readonly prompt: readonly PromptMessage[] }) =>
    answer(options.prompt),
  doStream: () => Promise.reject(new Error("the scripted model does not stream")),
}

/** The model for `danwo.config.ts`: the scripted one, a model `DANWO_MODEL` names, or the default. */
export function agentModel(): LanguageModel {
  const chosen = process.env.DANWO_MODEL

  if (chosen === "scripted") return scriptedModel

  return chosen ?? DEFAULT_MODEL
}

/** Whether the agent tests can run: a key for the agent's model, or the scripted model. */
export function agentSkip(): false | string {
  if (process.env.DANWO_MODEL === "scripted" || process.env.AI_GATEWAY_API_KEY) return false

  return "set AI_GATEWAY_API_KEY (or DANWO_MODEL=scripted) to run agent tests"
}
