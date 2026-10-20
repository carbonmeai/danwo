/**
 * The agent's guard rails without a browser: noticing a step going round in circles, spending
 * against budgets, and a conversation that only grows until its size budget, then drops older
 * page views in one go and marks its newest message as a cache breakpoint.
 */
import { describe, expect, it } from "vitest"

import { Spend, Spends } from "../src/agent/budget.ts"
import { LoopGuard } from "../src/agent/guard.ts"
import { onceEachCall, toolCallsOf } from "../src/agent/loop.ts"
import { Transcript, VIEW_MARK } from "../src/agent/transcript.ts"

const cost = (costUsd?: number) => ({
  inputTokens: 10,
  outputTokens: 5,
  ...(costUsd !== undefined && { costUsd }),
})

describe("loop guard", () => {
  it("warns once on the same action three times, then stops the step", () => {
    const guard = new LoopGuard()

    expect(guard.note("click e1", false).kind).toBe("ok")
    expect(guard.note("click e1", false).kind).toBe("ok")
    expect(guard.note("click e1", false)).toMatchObject({ kind: "warn" })
    expect(guard.note("click e1", false).kind).toBe("ok")
    expect(guard.note("click e1", false).kind).toBe("ok")
    expect(guard.note("click e1", false)).toMatchObject({
      kind: "stop",
      reason: expect.stringMatching(/same action 3 times/),
    })
  })

  it("notices a cycle of two or three actions going round twice", () => {
    const pairs = new LoopGuard()
    const results = ["open", "close", "open", "close"].map((s) => pairs.note(s, false).kind)

    expect(results).toEqual(["ok", "ok", "ok", "warn"])

    const triples = new LoopGuard()
    const three = ["a", "b", "c", "a", "b", "c"].map((s) => triples.note(s, false).kind)

    expect(three.at(-1)).toBe("warn")
  })

  it("notices a run of failed actions, even different ones", () => {
    const guard = new LoopGuard()

    guard.note("click e1", true)
    guard.note("fill e2", true)

    expect(guard.note("click e3", true)).toMatchObject({
      kind: "warn",
      message: expect.stringMatching(/3 actions in a row that failed/),
    })
  })
})

describe("budgets", () => {
  it("stops a step at its turns, calls or cost, and a test at its own limit", () => {
    const turns = new Spend({ turns: 2 }, "step")

    turns.turn()
    turns.check()
    turns.turn()
    expect(() => turns.check()).toThrow(/used up its budget of 2 turns/)

    const dollars = new Spend({ costUsd: 0.01 }, "step")

    dollars.call(cost(0.006))
    dollars.check()
    dollars.call(cost(0.006))
    expect(() => dollars.check()).toThrow(/\$0\.01/)

    const test = new Spend({ modelCalls: 3 }, "test")
    const first = new Spends(new Spend({}, "step 1"), test)
    const second = new Spends(new Spend({}, "step 2"), test)

    first.call(cost())
    first.call(cost())
    second.call(cost())

    expect(() => second.check()).toThrow(
      expect.objectContaining({
        code: "BUDGET_EXCEEDED",
        message: expect.stringMatching(/the test used up its budget of 3 model calls/),
      }),
    )
  })
})

/** A message carrying page view `n`. */
const view = (n: number) => `did ${n}${VIEW_MARK}${"x".repeat(400)} view ${n}`

describe("transcript", () => {
  it("only grows until its budget, so each prompt starts with the one before", () => {
    const transcript = new Transcript(10_000)
    const prompts: string[] = []

    transcript.push({ role: "user", content: view(0) })

    for (let n = 1; n <= 5; n++) {
      prompts.push(JSON.stringify(transcript.forModel().map((m) => m.content)))
      transcript.push({ role: "user", content: view(n) })
      transcript.compactIfOver()
    }

    for (let at = 1; at < prompts.length; at++) {
      const before = prompts[at - 1] ?? ""

      expect(prompts[at]?.startsWith(before.slice(0, -1))).toBe(true)
    }

    expect(transcript.compacted).toBe(0)
  })

  it("drops every view but the newest in one go once over budget, then grows again", () => {
    const transcript = new Transcript(1_500)
    const texts = () =>
      transcript.forModel().map((m) => (typeof m.content === "string" ? m.content : ""))
    let n = 0

    while (transcript.compacted === 0) {
      transcript.push({ role: "user", content: view(n++) })
      transcript.compactIfOver()
    }

    const compacted = texts()

    expect(compacted.at(-1)).toContain(`view ${n - 1}`)
    expect(compacted.slice(0, -1).every((text) => !text.includes(VIEW_MARK))).toBe(true)
    expect(compacted[0]).toContain("an earlier view of the page, left out")

    transcript.push({ role: "user", content: view(n) })
    transcript.compactIfOver()

    /* Below the budget again: what was sent stays as it was, and views pile up anew. */
    expect(texts().slice(0, compacted.length)).toEqual(compacted)
    expect(transcript.compacted).toBe(1)
  })

  it("marks the newest message as a cache breakpoint", () => {
    const transcript = new Transcript()

    transcript.push({ role: "user", content: "a" }, { role: "user", content: "b" })

    const sent = transcript.forModel()

    expect(sent[0]?.providerOptions).toBeUndefined()
    expect(sent[1]?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    })
  })
})

describe("a model's answer", () => {
  it("keeps a call repeated under the same id once, so it gets one result", () => {
    const look = { type: "tool-call" as const, toolCallId: "toolu_1", toolName: "look", input: {} }
    const click = {
      type: "tool-call" as const,
      toolCallId: "toolu_2",
      toolName: "click",
      input: {},
    }
    const answer = onceEachCall([
      { role: "assistant", content: [{ type: "text", text: "Looking" }, look, click, look] },
      { role: "assistant", content: [look] },
    ])

    expect(toolCallsOf(answer).map((call) => call.toolCallId)).toEqual(["toolu_1", "toolu_2"])
    expect(answer[0]?.content).toHaveLength(3)
  })
})
