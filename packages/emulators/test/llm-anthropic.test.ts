import Anthropic from "@anthropic-ai/sdk"
import { beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { llm, llmCalls, llmOutboundFaults, seedLlm } from "../src/llm/index.ts"
import { ANTHROPIC_KEY, anthropicClient, faultFetch } from "./llm-client.ts"

let emulator: Emulator

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "lookup_order",
    description: "Finds an order",
    input_schema: { type: "object", properties: { order: { type: "number" } } },
  },
]

beforeEach(() => {
  emulator = createEmulator(llm)
  seedLlm(emulator.store, {
    scripts: [
      {
        match: { provider: "anthropic", system: /support/, user: /where is order/ },
        reply: [
          { toolCalls: [{ name: "lookup_order", arguments: { order: 7 } }] },
          { text: "Order 7 ships tomorrow." },
        ],
      },
      { match: { provider: "anthropic" }, reply: { text: "Happy to help." } },
    ],
  })
})

describe("Messages", () => {
  it("answers with text, and with a tool call then text", async () => {
    const client = anthropicClient(emulator)
    const plain = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 200,
      messages: [{ role: "user", content: "hi" }],
    })

    expect(plain.content).toEqual([{ type: "text", text: "Happy to help.", citations: null }])
    expect(plain.stop_reason).toBe("end_turn")

    const asked = {
      model: "claude-sonnet-5",
      max_tokens: 200,
      system: "You are a support agent.",
      tools: TOOLS,
    }
    const first = await client.messages.create({
      ...asked,
      messages: [{ role: "user", content: "where is order 7?" }],
    })
    const use = first.content.find((block) => block.type === "tool_use")

    expect(first.stop_reason).toBe("tool_use")
    expect(use?.type === "tool_use" && use.input).toEqual({ order: 7 })

    const second = await client.messages.create({
      ...asked,
      messages: [
        { role: "user", content: "where is order 7?" },
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: use?.id ?? "", content: "shipping" }],
        },
      ],
    })

    expect(second.content[0]?.type === "text" && second.content[0].text).toBe(
      "Order 7 ships tomorrow.",
    )
  })

  it("streams a tool call the SDK assembles into its final message", async () => {
    const stream = anthropicClient(emulator).messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 200,
      system: "You are a support agent.",
      tools: TOOLS,
      messages: [{ role: "user", content: "where is order 7?" }],
    })
    const final = await stream.finalMessage()
    const use = final.content.find((block) => block.type === "tool_use")

    expect(use?.type === "tool_use" && use.input).toEqual({ order: 7 })
    expect(final.stop_reason).toBe("tool_use")
  })

  it("counts tokens", async () => {
    const counted = await anthropicClient(emulator).messages.countTokens({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "twelve chars" }],
    })

    expect(counted.input_tokens).toBe(3)
  })

  it("acts out a refusal and a cut-off answer", async () => {
    const ask = (behaviour: string) =>
      anthropicClient(emulator, behaviour).messages.create({
        model: "claude-sonnet-5",
        max_tokens: 200,
        messages: [{ role: "user", content: "hi" }],
      })

    expect((await ask("refusal")).stop_reason).toBe("refusal")
    expect((await ask("truncated")).stop_reason).toBe("max_tokens")
    expect(
      llmCalls(emulator)
        .all()
        .map((call) => call.fault),
    ).toEqual(["refusal", "truncated"])
  })

  it("is overloaded with a 529 the SDK reads as Anthropic's own error", async () => {
    const overloaded = llmOutboundFaults({
      host: "api.anthropic.com",
      method: "POST",
      path: "/v1/messages",
    }).find((fault) => fault.kind === "status" && fault.status === 529)

    if (overloaded?.kind !== "status") throw new Error("no 529 fault")

    const client = new Anthropic({
      apiKey: ANTHROPIC_KEY,
      fetch: faultFetch(overloaded),
      maxRetries: 0,
    })

    await expect(
      client.messages.create({ model: "claude-sonnet-5", max_tokens: 10, messages: [] }),
    ).rejects.toMatchObject({ status: 529, error: { error: { type: "overloaded_error" } } })
  })

  it("lists models in Anthropic's shape on its host", async () => {
    const models = await anthropicClient(emulator).models.list()

    expect(models.data.map((model) => model.id)).toContain("claude-sonnet-5")
  })
})
