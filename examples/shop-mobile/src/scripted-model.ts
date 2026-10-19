/**
 * A model that plays the shop's agent steps the way a person would, from the screen it is shown:
 * it reads the credits, taps the buy button, then fills the email and pays. Tests record agent
 * steps with it on machines without a model key (`DANWO_MODEL=scripted`); the recordings then
 * replay like any other.
 */

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
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

/** Every string in a prompt, joined: what the model reads. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(textOf).join("\n")
  if (typeof value === "object" && value !== null)
    return Object.values(value).map(textOf).join("\n")

  return ""
}

/** The ref of the element with this role and name in the latest view of `prompt`. */
function refOf(prompt: string, role: string, name: string): string {
  const line = `- ${role} ${JSON.stringify(name)}`
  const at = prompt.lastIndexOf(line)
  const ref = at < 0 ? undefined : /\[ref=(e\d+)\]/.exec(prompt.slice(at))?.[1]

  if (ref === undefined) throw new Error(`scripted model: no ${role} "${name}" on the screen`)

  return ref
}

/** The answer to a prompt: the next action of the step it is in, or done. */
function answer(prompt: readonly { readonly role: string; readonly content: unknown }[]) {
  const text = textOf(prompt.filter((message) => message.role !== "system"))
  const acted = prompt.filter((message) => message.role === "tool").length

  if (/^Extract: /m.test(text)) {
    const credits = /- text "Credits: \d+" \[ref=(e\d+)\]/.exec(text)?.[1]

    return call("read", { fields: [{ path: "credits", ref: credits, as: "number" }] })
  }

  if (text.includes("Instruction: Start buying")) {
    return acted === 0
      ? call("tap", { ref: refOf(text, "button", "Buy 500 credits") })
      : call("done", { status: "passed", summary: "opened checkout" })
  }

  if (acted === 0)
    return call("fill", { ref: refOf(text, "textbox", "Email"), text: "buyer@example.com" })
  if (acted === 1) return call("tap", { ref: refOf(text, "button", "Pay $5.00") })

  return call("done", { status: "passed", summary: "paid" })
}

/** The scripted model, as an AI SDK language model. */
export const scriptedModel = {
  specificationVersion: "v4" as const,
  provider: "danwo",
  modelId: "scripted-shopper",
  supportedUrls: {},
  doGenerate: async (options: {
    readonly prompt: readonly { readonly role: string; readonly content: unknown }[]
  }) => answer(options.prompt),
  doStream: () => Promise.reject(new Error("the scripted model does not stream")),
}
